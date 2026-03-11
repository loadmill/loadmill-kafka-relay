
import {
  Consumer,
  EachMessagePayload,
  PartitionOffset,
} from '@confluentinc/kafka-javascript/types/kafkajs';

import log from '../../log';
import { thisRelayInstanceId } from '../../multi-instance';
import { getRedisClient } from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';
import { KafkaType } from '../../types/kafkajs-confluent';

import {
  MAX_TOPIC_MESSAGES_LENGTH,
  TOPIC_MESSAGES_TTL_SECONDS,
} from './constants';
import {
  fromKafkaToConsumedMessage,
  getMessagesFromRedis,
  normalizeConsumedMessageValue,
} from './messages';
import {
  toTopicMessagesKey,
  toTopicPartitionOffsetWatermarksKey,
} from './redis-keys';
import { appendTopicMessageWithDedupe } from './redis-topic-dedupe';
import { ShallowSubscriber, Subscriber } from './subscriber';
import { ensureTopicConsumerRunning } from './topic-consumers-manager';
import { toTopicGroupId } from './topic-utils';

export type RedisSubscriberOptions = {
  asTopicConsumer?: boolean;
  debugParams?: { instanceId: string };
  takeOverParams?: TakeOverParams;
};

export class RedisSubscriber extends Subscriber {
  private redisClient: RedisClient = getRedisClient();
  readonly instanceId: string = thisRelayInstanceId;

  constructor(
    subscribeParams: SubscribeParams,
    subscribeOptions: SubscribeOptions,
    options?: RedisSubscriberOptions,
  ) {
    const { takeOverParams, debugParams, asTopicConsumer = false } = options ?? {};
    const groupId = asTopicConsumer ? toTopicGroupId(subscribeParams.topic) : undefined;
    super(subscribeParams, subscribeOptions, takeOverParams?.id, groupId, asTopicConsumer);
    takeOverParams && (this.timeOfSubscription = takeOverParams.timeOfSubscription);
    debugParams && (this.instanceId = debugParams.instanceId);
  }

  async addMessage({ message, partition }: EachMessagePayload): Promise<void> {
    const consumedMessage = await fromKafkaToConsumedMessage(message);

    // Normalize the value to ensure Avro union types are type mapped
    const normalizedValue = normalizeConsumedMessageValue(consumedMessage.value);

    const messageToStore = {
      ...consumedMessage,
      partition,
      value: normalizedValue,
    };

    const serializedMessage = JSON.stringify(messageToStore);
    const messagesKey = toTopicMessagesKey(this.topic);
    const watermarkKey = toTopicPartitionOffsetWatermarksKey(this.topic);
    const result = await appendTopicMessageWithDedupe({
      maxMessages: MAX_TOPIC_MESSAGES_LENGTH,
      messagesKey,
      offset: message.offset,
      partition,
      redisClient: this.redisClient,
      serializedMessage,
      timestamp: Number(message.timestamp),
      ttlSeconds: TOPIC_MESSAGES_TTL_SECONDS,
      watermarkKey,
    });
    if (result === 'duplicate') {
      log.debug({ offset: message.offset, partition, topic: this.topic }, 'Skipped duplicate topic message');
    }
  }

  // Re-seeks a running topic consumer to latest messages and resets the
  // deduplication watermark so replayed messages are not silently dropped.
  async reseekToLatestMessages(): Promise<void> {
    if (!this.consumer || !this.kafka) {
      throw new Error('Kafka consumer is not initialized');
    }
    const watermarkKey = toTopicPartitionOffsetWatermarksKey(this.topic);
    await this.redisClient.del(watermarkKey);
    const partitions = await getSeekOffsets(this.kafka, this.topic);
    await seekToPartitions(this.consumer, partitions, this.topic);
  }

  // Used when this subscriber acts as the shared topic consumer (asTopicConsumer = true).
  async subscribeAsTopicConsumer(): Promise<void> {
    if (!this.consumer || !this.kafka) {
      throw new Error('Kafka consumer is not initialized');
    }

    await this.consumer.connect();
    const partitions = await getSeekOffsets(this.kafka, this.topic);
    await this.consumer.subscribe({ topic: this.topic });
    await this.consumer.run({
      eachMessage: async (payload) => {
        await this.addMessage(payload);
      },
    });
    await seekToPartitions(this.consumer, partitions, this.topic);
  }

  // In multi-instance mode we keep *one* Kafka consumer per topic (per cluster) and store messages once.
  // Each subscriber only records metadata (id/topic/subscription time) and reads from the topic list.
  async subscribe(): Promise<void> {
    await ensureTopicConsumerRunning(
      { brokers: this.kafkaConfig.brokers, topic: this.topic },
      {
        connectionTimeout: this.kafkaConfig.connectionTimeout,
        sasl: this.kafkaConfig.sasl,
        ssl: this.kafkaConfig.ssl,
      },
    );
  }

  async getMessages(limit: number, offset: number): Promise<ConsumedMessage[]> {
    return await getMessagesFromRedis(this.topic, limit, offset);
  }
}

export type RedisSubscribers = {
  [id: string]: RedisSubscriber;
};

export type TakeOverParams = {
  id: string;
  timeOfSubscription: number;
};

export type ShallowRedisSubscribers = {
  [id: string]: ShallowRedisSubscriber;
};

export type ShallowRedisSubscriber = ShallowSubscriber & Pick<RedisSubscriber, 'instanceId'>;

const getSeekOffsets = async (
  kafka: NonNullable<KafkaType>,
  topic: string,
): Promise<PartitionOffset[]> => {
  const admin = kafka.admin();
  await admin.connect();
  const offsets = await admin.fetchTopicOffsets(topic);
  await admin.disconnect();
  return offsets.map(({ partition, high, low }) => ({
    offset: String(Math.max(Number(low), Number(high) - MAX_TOPIC_MESSAGES_LENGTH)),
    partition,
  }));
};

const seekToPartitions = async (consumer: Consumer, partitions: PartitionOffset[], topic: string) => {
  await Promise.all(
    partitions.map(({ offset, partition }) =>
      consumer.seek({ offset, partition, topic }),
    ),
  );
};
