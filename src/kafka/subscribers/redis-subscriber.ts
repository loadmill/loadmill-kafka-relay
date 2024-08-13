import { EachMessagePayload } from 'kafkajs';

import { thisRelayInstanceId } from '../../multi-instance';
import { getRedisClient } from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import { MAX_SUBSCRIBER_TTL_SECONDS } from './constants';
import {
  fromKafkaToConsumedMessage,
  getMessagesFromRedis,
} from './messages';
import { toMessagesKey } from './redis-keys';
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
    const serializedMessage = JSON.stringify(consumedMessage);

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
