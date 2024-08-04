import { EachMessagePayload } from 'kafkajs';

import { redisClient, RedisClient } from '../../redis/client';
import { KEY_DOES_NOT_EXIST } from '../../redis/constants';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import { MAX_SUBSCRIBER_TTL_SECONDS } from './constants';
import { toMessagesKey } from './redis-keys';
import { Subscriber } from './subscriber';
import { fromKafkaToConsumedMessage } from './to-consumed-message';

export class RedisSubscriber extends Subscriber {
  private redisClient = redisClient as RedisClient;

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

  async getMessages(): Promise<ConsumedMessage[]> {
    const messages = await this.redisClient.lRange(toMessagesKey(this.id), 0, -1);
    try {
      return messages.map((message: string) => JSON.parse(message));
    } catch (e) {
      return [];
    }
  }

  async setMessages(messages: ConsumedMessage[]): Promise<void> {
    const serializedMessages = messages.map((message) => JSON.stringify(message));
    await this.redisClient.multi()
      .rPush(toMessagesKey(this.id), serializedMessages)
      .expire(toMessagesKey(this.id), MAX_SUBSCRIBER_TTL_SECONDS)
      .exec();
  }
}

export type RedisSubscribers = {
  [id: string]: RedisSubscriber;
};

export type TakeOverParams = {
  id: string;
  timeOfSubscription: number;
};
