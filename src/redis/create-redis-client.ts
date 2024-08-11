import { createClient } from 'redis';

import log from '../log';

import { RedisClient } from './types';

export enum RedisClientType {
  CLIENT = 'Client',
  SUBSCRIBER = 'Subscriber',
}

export const createRedisClient = (clientType: RedisClientType): RedisClient | undefined => {
  try {
    if (process.env.REDIS_URL) {
      const url = process.env.REDIS_URL;
      const redisClient = createClient({
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > 100) {
              return new Error('Too many retries');
            }
            return 0;
          },
        },
        url,
      });
      void redisClient
        .on('error', (error) => {
          log.error(error, `Redis ${clientType} Error`);
        })
        .on('connect', () => {
          log.info({ url }, `Redis ${clientType} is Connected!`);
        })
        .on('ready', () => {
          log.info({ url }, `Redis ${clientType} is Ready!`);
        })
        .connect();

      return redisClient;
    }
  } catch (error) {
    log.error(error);
    process.exit(1);
  }
};
