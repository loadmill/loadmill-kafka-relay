import {
  Consumer,
  EachMessagePayload,
  PartitionOffset,
} from '@confluentinc/kafka-javascript/types/kafkajs';

import log from '../../../log';
import { thisRelayInstanceId } from '../../../multi-instance';
import { getRedisClient } from '../../../redis/redis-client';
import { RedisClient } from '../../../redis/types';
import { SubscribeOptions, SubscribeParams } from '../../../types';
import {
  MAX_TOPIC_MESSAGES_LENGTH,
  TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS,
  TOPIC_LEADER_LOCK_TTL_SECONDS,
  TOPIC_MESSAGES_TTL_SECONDS,
} from '../constants';
import { fromKafkaToConsumedMessage } from '../messages';
import { toTopicLeaderKey, toTopicMessagesKey } from '../redis-keys';
import { Subscriber } from '../subscriber';
import { toTopicGroupId } from '../topic-utils';

type TopicEntry = {
  consumer?: RedisTopicConsumer;
  renewIntervalId?: NodeJS.Timeout;
  startPromise?: Promise<void>;
};

const topics = new Map<string, TopicEntry>();

export const releaseAllTopicLeadership = async (): Promise<void> => {
  const redisClient = getRedisClient();
  await Promise.all(
    Array.from(topics.keys()).map(async (topic) => {
      try {
        await stopTopicConsumer(topic, redisClient, 'graceful shutdown');
      } catch (error) {
        log.debug({ error, topic }, 'Failed releasing topic leadership (best-effort)');
      }
    }),
  );
};

export const ensureTopicConsumerRunning = async (
  { brokers, topic }: SubscribeParams,
  { connectionTimeout, sasl, ssl }: SubscribeOptions,
  timestamp?: number,
): Promise<void> => {
  const existing = topics.get(topic);
  if (existing?.startPromise) {
    await existing.startPromise;
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
        void renewLeadershipOrStop(topic);
      }, TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);
    }

    if (entry.consumer) {
      return;
    }

    log.info({ thisRelayInstanceId, topic }, 'Starting topic consumer');
    entry.consumer = new RedisTopicConsumer(
      { brokers, topic },
      { connectionTimeout, sasl, ssl },
    );

    await entry.consumer.subscribe(timestamp);
  })().catch((error) => {
    log.error({ error, topic }, 'Failed starting topic consumer');
    throw error;
  });

  await entry.startPromise;
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
      await consumer.consumer.disconnect();
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

class RedisTopicConsumer extends Subscriber {
  private readonly redisClient: RedisClient = getRedisClient();

  constructor(
    subscribeParams: SubscribeParams,
    subscribeOptions: SubscribeOptions,
  ) {
    super(
      subscribeParams,
      subscribeOptions,
      undefined,
      toTopicGroupId(subscribeParams.topic),
    );
  }

  // For topic consumers we want crash recovery using Kafka committed offsets.
  // Therefore: only seek by timestamp when the caller explicitly provides one.
  async subscribe(timestamp?: number): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic });
    await this.consumer.run({
      eachMessage: async (payload) => {
        await this.addMessage(payload);
      },
    });

    if (timestamp == null) {
      return;
    }

    const partitions = await getPartitionsByTimestamp(this.kafka, this.topic, timestamp);
    await assignPartitions(this.consumer, partitions, this.topic);
  }

  async addMessage({ message }: EachMessagePayload): Promise<void> {
    const consumedMessage = await fromKafkaToConsumedMessage(message);

    const normalizedValue = typeof consumedMessage.value === 'string'
      ? consumedMessage.value
      : JSON.parse(consumedMessage.value.toString());

    const messageToStore = {
      ...consumedMessage,
      value: normalizedValue,
    };

    const serializedMessage = JSON.stringify(messageToStore);
    const messagesKey = toTopicMessagesKey(this.topic);

    await this.redisClient.multi()
      .rPush(messagesKey, serializedMessage)
      .lTrim(messagesKey, -MAX_TOPIC_MESSAGES_LENGTH, -1)
      .expire(messagesKey, TOPIC_MESSAGES_TTL_SECONDS)
      .exec();
  }
}

const getPartitionsByTimestamp = async (
  kafka: RedisTopicConsumer['kafka'],
  topic: string,
  timestamp: number,
): Promise<PartitionOffset[]> => {
  const admin = kafka.admin();
  await admin.connect();
  const partitions = await admin.fetchTopicOffsetsByTimestamp(topic, timestamp);
  await admin.disconnect();
  return partitions;
};

const assignPartitions = async (consumer: Consumer, partitions: PartitionOffset[], topic: string) => {
  await Promise.all(
    partitions.map(({ offset, partition }) =>
      consumer.seek({ offset, partition, topic }),
    ),
  );
};
