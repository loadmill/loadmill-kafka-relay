import {
  createRedisClient,
  RedisClientType,
} from './create-redis-client';
import { RedisClient } from './types';

let redisSubscriberClient: RedisClient | undefined;

export const getRedisSubscriberClient = (): RedisClient | undefined => {
  if (!redisSubscriberClient) {
    redisSubscriberClient = createRedisClient(RedisClientType.SUBSCRIBER);
  }

  return redisSubscriberClient;
};
