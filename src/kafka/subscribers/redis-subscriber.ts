
import { EachMessagePayload } from '@confluentinc/kafka-javascript/types/kafkajs';

import { thisRelayInstanceId } from '../../multi-instance/relay-instance-id';
import { getRedisClient } from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import { MAX_SUBSCRIBER_TTL_SECONDS } from './constants';
import {
  fromKafkaToConsumedMessage,
} from './messages';
import { toMessagesKey } from './redis-keys';
import { getMessagesFromRedis } from './redis-messages';
import { ShallowSubscriber, Subscriber } from './subscriber';

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
    const messagesKey = toMessagesKey(this.id);

    await this.redisClient.multi()
      .rPush(messagesKey, serializedMessage)
      .expire(messagesKey, MAX_SUBSCRIBER_TTL_SECONDS)
      .exec();
  }

  async getMessages(subscriberId: string = this.id): Promise<ConsumedMessage[]> {
    return await getMessagesFromRedis(subscriberId);
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
