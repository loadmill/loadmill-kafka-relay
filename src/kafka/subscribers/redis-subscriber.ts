
import { EachMessagePayload } from '@confluentinc/kafka-javascript/types/kafkajs';

import { thisRelayInstanceId } from '../../multi-instance';
import { getRedisClient } from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import { MAX_TOPIC_MESSAGES_LENGTH, TOPIC_MESSAGES_TTL_SECONDS } from './constants';
import {
  fromKafkaToConsumedMessage,
  getMessagesFromRedis,
} from './messages';
import { toTopicMessagesKey } from './redis-keys';
import { ShallowSubscriber, Subscriber } from './subscriber';
import { ensureTopicConsumerRunning } from './topic-consumers-manager';

export class RedisSubscriber extends Subscriber {
  private redisClient: RedisClient = getRedisClient();
  readonly instanceId: string = thisRelayInstanceId;

  constructor(
    subscribeParams: SubscribeParams,
    subscribeOptions: SubscribeOptions,
    takeOverParams?: TakeOverParams,
    debugParams?: { instanceId: string },
  ) {
    super(subscribeParams, subscribeOptions, takeOverParams?.id);
    takeOverParams && (this.timeOfSubscription = takeOverParams.timeOfSubscription);
    debugParams && (this.instanceId = debugParams.instanceId);
  }

  async addMessage({ message }: EachMessagePayload): Promise<void> {
    const consumedMessage = await fromKafkaToConsumedMessage(message);

    // Normalize the value to ensure Avro union types are type mapped
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

  async getMessages(subscriberId: string = this.id): Promise<ConsumedMessage[]> {
    void subscriberId;
    return await getMessagesFromRedis(this.topic, this.timeOfSubscription);
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
