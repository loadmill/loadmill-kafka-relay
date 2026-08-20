import log from '../../../log';
import { thisRelayInstanceId } from '../../../multi-instance';
import { getRedisClient } from '../../../redis/redis-client';
import { RedisClient } from '../../../redis/types';
import { SubscribeOptions, SubscribeParams } from '../../../types';
import {
  TOPIC_CONSUMER_DISCONNECT_TIMEOUT_MS,
  TOPIC_CONSUMER_UNHEALTHY_ASSIGNMENT_THRESHOLD,
  TOPIC_LEADER_LOCK_FENCE_MARGIN_MS,
  TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS,
  TOPIC_LEADER_LOCK_TTL_SECONDS,
  TOPIC_LEADER_READY_POLL_INTERVAL_MS,
  TOPIC_LEADER_READY_WAIT_TIMEOUT_MS,
  TOPIC_LEADERSHIP_RELEASE_TIMEOUT_MS,
} from '../constants';
import {
  toTopicLeaderKey,
  toTopicLeaderReadyKey,
  toTopicMessagesKey,
} from '../redis-keys';
import { RedisSubscriber } from '../redis-subscriber';

type TopicEntry = {
  consumer?: RedisSubscriber;
  fenceTimeoutId?: NodeJS.Timeout;
  ownershipToken?: string;
  renewIntervalId?: NodeJS.Timeout;
  renewPromise?: Promise<void>;
  renewalGeneration?: number;
  startGeneration?: number;
  startingConsumer?: RedisSubscriber;
  stopPromise?: Promise<void>;
  transitionPromise?: Promise<void>;
  unhealthyAssignmentChecks?: number;
};

type TopicLeadershipState = {
  leader: string | null;
  readyLeader: string | null;
};

type LeadershipAcquisition = {
  acquired: boolean;
  refreshStartedAt: number;
};

const CLEAR_OWNED_READINESS_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('DEL', KEYS[1])
`.trim();

const MARK_READY_IF_LEADER_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 1
`.trim();

const RELEASE_LEADERSHIP_SCRIPT = `
local released = 0
if redis.call('GET', KEYS[1]) == ARGV[1] then
  released = released + redis.call('DEL', KEYS[1])
end
if redis.call('GET', KEYS[2]) == ARGV[1] then
  released = released + redis.call('DEL', KEYS[2])
end
return released
`.trim();

const RENEW_LEADERSHIP_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
if ARGV[3] == '1' then
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
elseif redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[2])
end
return 1
`.trim();

const topics = new Map<string, TopicEntry>();
let ownershipGeneration = 0;

const nextOwnershipToken = (): string =>
  `${thisRelayInstanceId}:${++ownershipGeneration}`;

const isOwnedByThisRelayInstance = (ownershipToken: string): boolean =>
  ownershipToken.startsWith(`${thisRelayInstanceId}:`);

const getOrCreateTopicEntry = (topic: string): TopicEntry => {
  const existing = topics.get(topic);
  if (existing) {
    return existing;
  }

  const entry: TopicEntry = {};
  topics.set(topic, entry);
  return entry;
};

export const ensureTopicConsumerRunning = (
  params: SubscribeParams,
  options: SubscribeOptions,
): Promise<void> => {
  const entry = getOrCreateTopicEntry(params.topic);
  if (entry.transitionPromise) {
    return entry.transitionPromise;
  }

  const transitionPromise = Promise.resolve()
    .then(() => ensureTopicConsumerRunningTransition(entry, params, options))
    .finally(() => {
      if (entry.transitionPromise === transitionPromise) {
        entry.transitionPromise = undefined;
      }
    });
  entry.transitionPromise = transitionPromise;
  return transitionPromise;
};

const ensureTopicConsumerRunningTransition = async (
  entry: TopicEntry,
  { brokers, topic }: SubscribeParams,
  { connectionTimeout, sasl, ssl }: SubscribeOptions,
): Promise<void> => {
  const readyDeadline = Date.now() + TOPIC_LEADER_READY_WAIT_TIMEOUT_MS;

  while (true) {
    if (entry.stopPromise) {
      await entry.stopPromise;
      continue;
    }

    if (entry.consumer) {
      const consumer = entry.consumer;
      const ownershipToken = entry.ownershipToken;
      if (!ownershipToken) {
        await stopTopicConsumer(topic, getRedisClient(), 'missing local ownership token');
        continue;
      }

      const { leader, readyLeader } = await withDeadline(
        getTopicLeadershipState(topic),
        readyDeadline,
        new Error(`Timed out checking topic leadership for ${topic}`),
      );
      if (entry.consumer !== consumer || entry.ownershipToken !== ownershipToken) {
        continue;
      }

      if (leader !== ownershipToken) {
        await stopTopicConsumer(topic, getRedisClient(), 'lost leadership');
        continue;
      }

      const captureReady = isCaptureReady(consumer, topic);
      if (readyLeader === ownershipToken && captureReady) {
        const count = await withDeadline(
          getRedisClient().zCard(toTopicMessagesKey(topic)),
          readyDeadline,
          new Error(`Timed out checking buffered topic messages for ${topic}`),
        );
        if (entry.consumer !== consumer || entry.ownershipToken !== ownershipToken) {
          continue;
        }
        if (count === 0) {
          await withDeadline(
            consumer.reseekToLatestMessages(),
            readyDeadline,
            new Error(`Timed out re-seeking topic consumer for ${topic}`),
          );
          if (entry.consumer !== consumer || entry.ownershipToken !== ownershipToken) {
            continue;
          }
        }
        return;
      }

      if (readyLeader === ownershipToken) {
        await withDeadline(
          clearTopicConsumerReadiness(topic, ownershipToken),
          readyDeadline,
          new Error(`Timed out withdrawing topic readiness for ${topic}`),
        );
        if (entry.consumer !== consumer || entry.ownershipToken !== ownershipToken) {
          continue;
        }
      }

      if (captureReady) {
        const markedReady = await withDeadline(
          markTopicConsumerReady(topic, ownershipToken),
          readyDeadline,
          new Error(`Timed out restoring topic readiness for ${topic}`),
        );
        if (entry.consumer !== consumer || entry.ownershipToken !== ownershipToken) {
          continue;
        }
        if (markedReady) {
          continue;
        }
      }

      if (Date.now() >= readyDeadline) {
        throw new Error(`Timed out waiting for the local topic consumer to recover for ${topic}`);
      }

      await delay(Math.min(
        TOPIC_LEADER_READY_POLL_INTERVAL_MS,
        readyDeadline - Date.now(),
      ));
      continue;
    }

    const { leader, readyLeader } = await withDeadline(
      getTopicLeadershipState(topic),
      readyDeadline,
      new Error(`Timed out checking topic leadership for ${topic}`),
    );
    if (leader) {
      if (isOwnedByThisRelayInstance(leader)) {
        await releaseTopicLeadershipWithinTimeout(topic, getRedisClient(), leader);
        continue;
      }

      if (leader === readyLeader) {
        return;
      }

      if (Date.now() >= readyDeadline) {
        throw new Error(`Timed out waiting for a ready topic consumer for ${topic}`);
      }

      await delay(Math.min(
        TOPIC_LEADER_READY_POLL_INTERVAL_MS,
        readyDeadline - Date.now(),
      ));
      continue;
    }

    if (readyLeader && isOwnedByThisRelayInstance(readyLeader)) {
      await withDeadline(
        clearTopicConsumerReadiness(topic, readyLeader),
        readyDeadline,
        new Error(`Timed out withdrawing stale topic readiness for ${topic}`),
      );
    }

    const startGeneration = (entry.startGeneration || 0) + 1;
    entry.startGeneration = startGeneration;
    const startPromise = startTopicConsumerIfLeader(
      entry,
      { brokers, topic },
      { connectionTimeout, sasl, ssl },
      startGeneration,
    );

    try {
      if (await withDeadline(
        startPromise,
        readyDeadline,
        new Error(`Timed out starting topic consumer for ${topic}`),
      )) {
        return;
      }
    } catch (error) {
      log.error({ error, topic }, 'Failed starting topic consumer');
      if (entry.startGeneration === startGeneration) {
        entry.startGeneration += 1;
      }
      await stopTopicConsumer(topic, getRedisClient(), 'topic consumer startup failed');
      throw error;
    }

    if (Date.now() >= readyDeadline) {
      throw new Error(`Timed out waiting for a ready topic consumer for ${topic}`);
    }

    await delay(Math.min(
      TOPIC_LEADER_READY_POLL_INTERVAL_MS,
      readyDeadline - Date.now(),
    ));
  }
};

const startTopicConsumerIfLeader = async (
  entry: TopicEntry,
  { brokers, topic }: SubscribeParams,
  { connectionTimeout, sasl, ssl }: SubscribeOptions,
  startGeneration: number,
): Promise<boolean> => {
  const ownershipToken = nextOwnershipToken();
  const acquisition = await acquireLeadership(topic, ownershipToken);
  if (!acquisition.acquired) {
    return false;
  }

  const acquisitionFenceDeadline = acquisition.refreshStartedAt
    + TOPIC_LEADER_LOCK_TTL_SECONDS * 1000
    - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS;
  if (
    !isCurrentStart(entry, startGeneration, topic)
    || Date.now() >= acquisitionFenceDeadline
  ) {
    await releaseTopicLeadershipWithinTimeout(
      topic,
      getRedisClient(),
      ownershipToken,
    );
    return false;
  }
  entry.ownershipToken = ownershipToken;

  startLeadershipRenewal(
    entry,
    topic,
    ownershipToken,
    acquisition.refreshStartedAt,
  );

  log.info({ ownershipToken, thisRelayInstanceId, topic }, 'Starting topic consumer');
  const candidate = new RedisSubscriber(
    { brokers, topic },
    { connectionTimeout, sasl, ssl },
    { asTopicConsumer: true },
  );
  entry.startingConsumer = candidate;
  await candidate.subscribeAsTopicConsumer();

  if (
    !isCurrentStart(entry, startGeneration, topic)
    || entry.startingConsumer !== candidate
    || entry.ownershipToken !== ownershipToken
  ) {
    throw new Error(`Lost topic leadership while starting consumer for ${topic}`);
  }

  entry.startingConsumer = undefined;
  entry.consumer = candidate;
  entry.unhealthyAssignmentChecks = 0;
  const markedReady = await markTopicConsumerReady(topic, ownershipToken);
  if (
    !markedReady
    || !isCurrentStart(entry, startGeneration, topic)
    || entry.consumer !== candidate
    || entry.ownershipToken !== ownershipToken
  ) {
    throw new Error(`Lost topic leadership while starting consumer for ${topic}`);
  }
  return true;
};

const acquireLeadership = async (
  topic: string,
  ownershipToken: string,
): Promise<LeadershipAcquisition> => {
  const lockKey = toTopicLeaderKey(topic);
  const redisClient = getRedisClient();
  const refreshStartedAt = Date.now();
  const result = await redisClient.set(lockKey, ownershipToken, {
    EX: TOPIC_LEADER_LOCK_TTL_SECONDS,
    NX: true,
  });

  if (result === 'OK') {
    log.info({ ownershipToken, thisRelayInstanceId, topic }, 'Acquired topic leadership');
    return { acquired: true, refreshStartedAt };
  }
  return { acquired: false, refreshStartedAt };
};

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMilliseconds: number,
  timeoutError: Error,
): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError), timeoutMilliseconds);
    timeoutId.unref();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const withDeadline = async <T>(
  promise: Promise<T>,
  deadline: number,
  timeoutError: Error,
): Promise<T> => withTimeout(
  promise,
  Math.max(0, deadline - Date.now()),
  timeoutError,
);

const clearTopicConsumerReadiness = async (
  topic: string,
  ownershipToken: string,
): Promise<void> => {
  await getRedisClient().eval(CLEAR_OWNED_READINESS_SCRIPT, {
    arguments: [ownershipToken],
    keys: [toTopicLeaderReadyKey(topic)],
  });
};

const getTopicLeadershipState = async (topic: string): Promise<TopicLeadershipState> => {
  const [leader, readyLeader] = await getRedisClient().mGet([
    toTopicLeaderKey(topic),
    toTopicLeaderReadyKey(topic),
  ]);
  return { leader, readyLeader };
};

const isCaptureReady = (consumer: RedisSubscriber, topic: string): boolean => {
  try {
    return consumer.isTopicConsumerCaptureReady();
  } catch (error) {
    log.debug({ error, topic }, 'Topic consumer assignment is not currently readable');
    return false;
  }
};

const markTopicConsumerReady = async (
  topic: string,
  ownershipToken: string,
): Promise<boolean> => {
  const result = await getRedisClient().eval(MARK_READY_IF_LEADER_SCRIPT, {
    arguments: [ownershipToken, String(TOPIC_LEADER_LOCK_TTL_SECONDS)],
    keys: [toTopicLeaderKey(topic), toTopicLeaderReadyKey(topic)],
  });
  return Number(result) === 1;
};

const releaseTopicLeadership = async (
  topic: string,
  redisClient: RedisClient,
  ownershipToken: string,
): Promise<void> => {
  await redisClient.eval(RELEASE_LEADERSHIP_SCRIPT, {
    arguments: [ownershipToken],
    keys: [toTopicLeaderKey(topic), toTopicLeaderReadyKey(topic)],
  });
};

const releaseTopicLeadershipWithinTimeout = async (
  topic: string,
  redisClient: RedisClient,
  ownershipToken: string,
): Promise<void> => {
  try {
    await withTimeout(
      releaseTopicLeadership(topic, redisClient, ownershipToken),
      TOPIC_LEADERSHIP_RELEASE_TIMEOUT_MS,
      new Error(`Timed out releasing topic leadership for ${topic}`),
    );
  } catch (error) {
    log.error({ error, topic }, 'Failed releasing topic leadership');
  }
};

const isCurrentStart = (
  entry: TopicEntry,
  startGeneration: number,
  topic: string,
): boolean => topics.get(topic) === entry && entry.startGeneration === startGeneration;

const isCurrentRenewal = (
  entry: TopicEntry,
  renewalGeneration: number,
  topic: string,
  ownershipToken: string,
): boolean => topics.get(topic) === entry
  && entry.renewalGeneration === renewalGeneration
  && entry.ownershipToken === ownershipToken;

const armLeadershipFence = (
  entry: TopicEntry,
  renewalGeneration: number,
  topic: string,
  ownershipToken: string,
  refreshStartedAt: number,
): void => {
  if (entry.fenceTimeoutId) {
    clearTimeout(entry.fenceTimeoutId);
  }

  const fenceDeadline = refreshStartedAt
    + TOPIC_LEADER_LOCK_TTL_SECONDS * 1000
    - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS;
  const fenceDelay = Math.max(0, fenceDeadline - Date.now());
  entry.fenceTimeoutId = setTimeout(() => {
    entry.fenceTimeoutId = undefined;
    if (!isCurrentRenewal(entry, renewalGeneration, topic, ownershipToken)) {
      return;
    }

    stopTopicConsumer(
      topic,
      getRedisClient(),
      'leadership renewal deadline exceeded',
    ).catch((error) => log.error({ error, topic }, 'Failed fencing topic consumer'));
  }, fenceDelay);
  entry.fenceTimeoutId.unref();
};

const renewLeadershipOrStop = async (
  entry: TopicEntry,
  renewalGeneration: number,
  topic: string,
  ownershipToken: string,
): Promise<void> => {
  const captureReady = Boolean(entry.consumer && isCaptureReady(entry.consumer, topic));
  const redisClient = getRedisClient();
  const refreshStartedAt = Date.now();
  const result = await redisClient.eval(RENEW_LEADERSHIP_SCRIPT, {
    arguments: [
      ownershipToken,
      String(TOPIC_LEADER_LOCK_TTL_SECONDS),
      captureReady ? '1' : '0',
    ],
    keys: [toTopicLeaderKey(topic), toTopicLeaderReadyKey(topic)],
  });

  if (!isCurrentRenewal(entry, renewalGeneration, topic, ownershipToken)) {
    return;
  }

  if (Number(result) !== 1) {
    await stopTopicConsumer(topic, redisClient, 'lost leadership');
    return;
  }

  armLeadershipFence(
    entry,
    renewalGeneration,
    topic,
    ownershipToken,
    refreshStartedAt,
  );
  if (!entry.consumer) {
    return;
  }

  if (captureReady) {
    entry.unhealthyAssignmentChecks = 0;
    return;
  }

  entry.unhealthyAssignmentChecks = (entry.unhealthyAssignmentChecks || 0) + 1;
  if (entry.unhealthyAssignmentChecks >= TOPIC_CONSUMER_UNHEALTHY_ASSIGNMENT_THRESHOLD) {
    await stopTopicConsumer(topic, redisClient, 'topic consumer lost partition assignment');
    return;
  }

  log.warn({
    topic,
    unhealthyAssignmentChecks: entry.unhealthyAssignmentChecks,
  }, 'Topic consumer partition assignment is not ready');
};

const startLeadershipRenewal = (
  entry: TopicEntry,
  topic: string,
  ownershipToken: string,
  acquisitionStartedAt: number,
): void => {
  if (entry.renewIntervalId) {
    return;
  }

  const renewalGeneration = (entry.renewalGeneration || 0) + 1;
  entry.renewalGeneration = renewalGeneration;
  armLeadershipFence(
    entry,
    renewalGeneration,
    topic,
    ownershipToken,
    acquisitionStartedAt,
  );

  entry.renewIntervalId = setInterval(() => {
    if (entry.renewPromise) {
      return;
    }

    const renewPromise = renewLeadershipOrStop(
      entry,
      renewalGeneration,
      topic,
      ownershipToken,
    )
      .catch((error) => log.warn({ error, topic }, 'Leadership renew failed'))
      .finally(() => {
        if (entry.renewPromise === renewPromise) {
          entry.renewPromise = undefined;
        }
      });
    entry.renewPromise = renewPromise;
  }, TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);
  entry.renewIntervalId.unref();
};

const stopTopicConsumer = async (
  topic: string,
  redisClient: RedisClient,
  reason: string,
): Promise<void> => {
  const entry = topics.get(topic);
  if (!entry) {
    return;
  }

  if (entry.stopPromise) {
    await entry.stopPromise;
    return;
  }

  const stopPromise = stopTopicConsumerEntry(topic, entry, redisClient, reason);
  entry.stopPromise = stopPromise;
  try {
    await stopPromise;
  } finally {
    if (entry.stopPromise === stopPromise) {
      entry.stopPromise = undefined;
    }
  }
};

const stopTopicConsumerEntry = async (
  topic: string,
  entry: TopicEntry,
  redisClient: RedisClient,
  reason: string,
): Promise<void> => {
  const ownershipToken = entry.ownershipToken;

  if (entry.renewIntervalId) {
    clearInterval(entry.renewIntervalId);
    entry.renewIntervalId = undefined;
  }
  if (entry.fenceTimeoutId) {
    clearTimeout(entry.fenceTimeoutId);
    entry.fenceTimeoutId = undefined;
  }
  entry.renewalGeneration = (entry.renewalGeneration || 0) + 1;
  entry.startGeneration = (entry.startGeneration || 0) + 1;
  entry.renewPromise = undefined;

  const consumers = Array.from(new Set([
    entry.consumer,
    entry.startingConsumer,
  ].filter((consumer): consumer is RedisSubscriber => Boolean(consumer))));
  entry.consumer = undefined;
  entry.startingConsumer = undefined;
  entry.ownershipToken = undefined;
  entry.unhealthyAssignmentChecks = 0;

  if (consumers.length > 0) {
    const disconnecting = Promise.all(consumers.map(async (consumer) => {
      log.warn({ reason, thisRelayInstanceId, topic }, 'Stopping topic consumer');
      if (consumer.consumer) {
        await consumer.consumer.disconnect();
      }
    }));

    try {
      await withTimeout(
        disconnecting,
        TOPIC_CONSUMER_DISCONNECT_TIMEOUT_MS,
        new Error(`Timed out disconnecting topic consumer for ${topic}`),
      );
    } catch (error) {
      log.fatal({ error, topic }, 'Unable to confirm topic consumer shutdown; exiting');
      process.exit(1);
    }
  }

  if (!ownershipToken) {
    return;
  }

  await releaseTopicLeadershipWithinTimeout(topic, redisClient, ownershipToken);
};
