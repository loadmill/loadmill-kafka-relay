import log from '../../../log';
import { thisRelayInstanceId } from '../../../multi-instance';
import { getRedisClient } from '../../../redis/redis-client';
import { RedisClient } from '../../../redis/types';
import { SubscribeOptions, SubscribeParams } from '../../../types';
import {
  TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS,
  TOPIC_LEADER_LOCK_TTL_SECONDS,
} from '../constants';
import { toTopicLeaderKey, toTopicMessagesKey } from '../redis-keys';
import { RedisSubscriber } from '../redis-subscriber';

type TopicEntry = {
  consumer?: RedisSubscriber;
  renewIntervalId?: NodeJS.Timeout;
  startPromise?: Promise<void>;
};

const topics = new Map<string, TopicEntry>();

export const ensureTopicConsumerRunning = async (
  { brokers, topic }: SubscribeParams,
  { connectionTimeout, sasl, ssl }: SubscribeOptions,
): Promise<void> => {
  // `startPromise` is treated as "start in progress" only.
  // It must not permanently short-circuit future leadership attempts.
  // If a start is already in progress, wait for it and re-check state.
  // (This avoids a race where a follower waits for a non-leader attempt and then returns forever.)
  while (true) {
    const existing = topics.get(topic);
    if (existing?.startPromise) {
      await existing.startPromise;
      continue;
    }

    if (existing?.consumer) {
      const count = await getRedisClient().lLen(toTopicMessagesKey(topic));
      if (count === 0) {
        await existing.consumer.reseekToLatestMessages();
      }
      return;
    }

    const entry: TopicEntry = existing || {};
    topics.set(topic, entry);

    entry.startPromise = (async () => {
      const isLeader = await acquireOrConfirmLeadership(topic);
      if (!isLeader) {
        return;
      }

      if (!entry.renewIntervalId) {
        entry.renewIntervalId = setInterval(() => {
          renewLeadershipOrStop(topic).catch((error) =>
            log.warn({ error, topic }, 'Leadership renew failed'),
          );
        }, TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);
        entry.renewIntervalId.unref();
      }

      if (entry.consumer) {
        return;
      }

      log.info({ thisRelayInstanceId, topic }, 'Starting topic consumer');
      entry.consumer = new RedisSubscriber(
        { brokers, topic },
        { connectionTimeout, sasl, ssl },
        { asTopicConsumer: true },
      );

      await entry.consumer.subscribeAsTopicConsumer();
    })()
      .catch((error) => {
        log.error({ error, topic }, 'Failed starting topic consumer');
        throw error;
      })
      .finally(() => {
        entry.startPromise = undefined;
      });

    await entry.startPromise;
    return;
  }
};

const acquireOrConfirmLeadership = async (topic: string): Promise<boolean> => {
  const redisClient = getRedisClient();
  const lockKey = toTopicLeaderKey(topic);

  const result = await redisClient.set(lockKey, thisRelayInstanceId, {
    EX: TOPIC_LEADER_LOCK_TTL_SECONDS,
    NX: true,
  });

  if (result === 'OK') {
    log.info({ thisRelayInstanceId, topic }, 'Acquired topic leadership');
    return true;
  }

  const current = await redisClient.get(lockKey);
  return current === thisRelayInstanceId;
};

const renewLeadershipOrStop = async (topic: string): Promise<void> => {
  const redisClient = getRedisClient();
  const lockKey = toTopicLeaderKey(topic);

  const current = await redisClient.get(lockKey);
  if (current !== thisRelayInstanceId) {
    await stopTopicConsumer(topic, redisClient, 'lost leadership');
    return;
  }

  await redisClient.expire(lockKey, TOPIC_LEADER_LOCK_TTL_SECONDS);
};

const stopTopicConsumer = async (topic: string, redisClient: RedisClient, reason: string): Promise<void> => {
  const entry = topics.get(topic);
  if (!entry) {
    return;
  }

  entry.renewIntervalId && clearInterval(entry.renewIntervalId);
  entry.renewIntervalId = undefined;

  const consumer = entry.consumer;
  entry.consumer = undefined;
  entry.startPromise = undefined;

  if (consumer) {
    try {
      log.warn({ reason, thisRelayInstanceId, topic }, 'Stopping topic consumer');
      if (consumer.consumer) {
        await consumer.consumer.disconnect();
      }
    } catch (error) {
      log.error({ error, topic }, 'Failed stopping topic consumer');
    }
  }

  // Best-effort cleanup; only delete if we still own it.
  try {
    const lockKey = toTopicLeaderKey(topic);
    const current = await redisClient.get(lockKey);
    if (current === thisRelayInstanceId) {
      await redisClient.del(lockKey);
    }
  } catch {
    // ignore
  }
};
