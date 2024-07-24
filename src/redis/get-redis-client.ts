import {
  createRedisClient,
  RedisClientType,
} from './create-redis-client';
import { RedisClient } from './types';

let redisClient: RedisClient | undefined;

export const getRedisClient = (): RedisClient | undefined => {
  if (!redisClient) {
    redisClient = createRedisClient(RedisClientType.CLIENT);
  }
  return redisClient;
};
