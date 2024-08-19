import { createClient } from 'redis';

import log from '../log';

import { RedisClient } from './types';

let redisClient: RedisClient;

export const getRedisClient = (): RedisClient => {
  if (!redisClient) {
    redisClient = createRedisClient(RedisClientType.CLIENT);
  }
  return redisClient;
};

let redisSubscriberClient: RedisClient;

export const getRedisSubscriberClient = (): RedisClient => {
  if (!redisSubscriberClient) {
    redisSubscriberClient = createRedisClient(RedisClientType.SUBSCRIBER);
  }

  return redisSubscriberClient;
};

enum RedisClientType {
  CLIENT = 'Client',
  SUBSCRIBER = 'Subscriber',
}

const createRedisClient = (clientType: RedisClientType): RedisClient => {
  try {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisClient = createClient({
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 100) {
            return new Error('Too many retries');
          }
          return 0;
        },
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
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
  } catch (error) {
    log.error(error);
    process.exit(1);
  }
};
