import { createClient } from 'redis';

import log from '../log';

export type RedisClient = ReturnType<typeof createClient>;

const getRedisClient = (): RedisClient | undefined => {
  try {
    if (process.env.REDIS_URL) {
      const url = process.env.REDIS_URL;
      const redisClient = createClient({ url });
      void redisClient
        .on('error', (error) => {
          log.error(error, 'Redis Client Error');
        })
        .on('connect', () => {
          log.info({ url }, 'Redis Client is Connected!');
        })
        .on('ready', () => {
          log.info({ url }, 'Redis Client is Ready!');
        })
        .connect();

      return redisClient;
    }
  } catch (error) {
    log.error(error, 'Error creating Redis client');
  }
};

export const redisClient = getRedisClient();
