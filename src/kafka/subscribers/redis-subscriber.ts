import { EachMessagePayload } from 'kafkajs';

import { KEY_DOES_NOT_EXIST } from '../../redis/constants';
import { getRedisClient } from '../../redis/get-redis-client';
import { RedisClient } from '../../redis/types';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import { MAX_SUBSCRIBER_TTL_SECONDS } from './constants';
import { getMessagesFromRedis } from './get-messages-from-redis';
import { toMessagesKey } from './redis-keys';
import { Subscriber } from './subscriber';
import { fromKafkaToConsumedMessage } from './to-consumed-message';

export class RedisSubscriber extends Subscriber {
  private redisClient = getRedisClient() as RedisClient;

  constructor(
    subscribeParams: SubscribeParams,
    subscribeOptions: SubscribeOptions,
    takeOverParams?: TakeOverParams,
  ) {
    super(subscribeParams, subscribeOptions, takeOverParams?.id);
    takeOverParams && (this.timeOfSubscription = takeOverParams.timeOfSubscription);
  }

  async addMessage({ message }: EachMessagePayload): Promise<void> {
    const consumedMessage = await fromKafkaToConsumedMessage(message);
    const serializedMessage = JSON.stringify(consumedMessage);

    const messagesKey = toMessagesKey(this.id);
    const ttl = await this.redisClient.ttl(messagesKey);
    const expiryInSeconds = ttl === KEY_DOES_NOT_EXIST ? MAX_SUBSCRIBER_TTL_SECONDS : ttl;
    await this.redisClient.multi()
      .rPush(messagesKey, serializedMessage)
      .expire(messagesKey, expiryInSeconds)
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
