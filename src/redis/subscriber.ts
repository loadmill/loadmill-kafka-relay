import { createClient } from 'redis';

import log from '../log';

export type RedisClient = ReturnType<typeof createClient>;

export const getRedisSubscriber = (): RedisClient | undefined => {
  try {
    if (process.env.REDIS_URL) {
      const url = process.env.REDIS_URL;
      const redisClient = createClient({ url });
      void redisClient
        .on('error', (error) => {
          log.error(error, 'Redis Subscriber Error');
        })
        .on('connect', () => {
          log.info({ url }, 'Redis Subscriber is Connected!');
        })
        .on('ready', () => {
          log.info({ url }, 'Redis Subscriber is Ready!');
        })
        .connect();

      return redisClient;
    }
  } catch (error) {
    log.error(error, 'Error creating Redis subscriber');
  }
};

export const redisSubscriber = getRedisSubscriber();
