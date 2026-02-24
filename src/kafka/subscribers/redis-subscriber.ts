
import {
  Consumer,
  EachMessagePayload,
  PartitionOffset,
} from '@confluentinc/kafka-javascript/types/kafkajs';

import { thisRelayInstanceId } from '../../multi-instance';
import { getRedisClient } from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';
import { KafkaType } from '../../types/kafkajs-confluent';

import { MAX_TOPIC_MESSAGES_LENGTH, TOPIC_MESSAGES_TTL_SECONDS } from './constants';
import {
  fromKafkaToConsumedMessage,
  getMessagesFromRedis,
  normalizeConsumedMessageValue,
} from './messages';
import { toTopicMessagesKey } from './redis-keys';
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

  async addMessage({ message }: EachMessagePayload): Promise<void> {
    const consumedMessage = await fromKafkaToConsumedMessage(message);

    // Normalize the value to ensure Avro union types are type mapped
    const normalizedValue = normalizeConsumedMessageValue(consumedMessage.value);

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

  // Used when this subscriber acts as the shared topic consumer (asTopicConsumer = true).
  // Only seeks by timestamp when explicitly provided — crash recovery relies on committed offsets.
  async subscribeAsTopicConsumer(timestamp?: number): Promise<void> {
    if (!this.consumer || !this.kafka) {
      throw new Error('Kafka consumer is not initialized');
    }

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
    await seekToPartitions(this.consumer, partitions, this.topic);
  }

  // In multi-instance mode we keep *one* Kafka consumer per topic (per cluster) and store messages once.
  // Each subscriber only records metadata (id/topic/subscription time) and reads from the topic list.
  async subscribe(timestamp?: number): Promise<void> {
    await ensureTopicConsumerRunning(
      { brokers: this.kafkaConfig.brokers, topic: this.topic },
      {
        connectionTimeout: this.kafkaConfig.connectionTimeout,
        sasl: this.kafkaConfig.sasl,
        ssl: this.kafkaConfig.ssl,
      },
      timestamp,
    );
  }

  async getMessages(): Promise<ConsumedMessage[]> {
    return await getMessagesFromRedis(this.topic);
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

const getPartitionsByTimestamp = async (
  kafka: NonNullable<KafkaType>,
  topic: string,
  timestamp: number,
): Promise<PartitionOffset[]> => {
  const admin = kafka.admin();
  await admin.connect();
  const partitions = await admin.fetchTopicOffsetsByTimestamp(topic, timestamp);
  await admin.disconnect();
  return partitions;
};

const seekToPartitions = async (consumer: Consumer, partitions: PartitionOffset[], topic: string) => {
  await Promise.all(
    partitions.map(({ offset, partition }) =>
      consumer.seek({ offset, partition, topic }),
    ),
  );
};
