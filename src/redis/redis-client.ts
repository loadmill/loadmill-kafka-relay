import { createClient } from 'redis';

import log from '../log';

import { REDIS_CONNECT_RETRIES } from './constants';
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
          if (retries > REDIS_CONNECT_RETRIES) {
            return false;
          }
          return 0;
        },
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
      url,
    });

    redisClient
      .on('error', (error) => {
        log.error(error, `Redis ${clientType} Error`);
      })
      .on('connect', () => {
        log.info({ url }, `Redis ${clientType} is Connected!`);
      })
      .on('ready', () => {
        log.info({ url }, `Redis ${clientType} is Ready!`);
      });

    void redisClient
      .connect()
      .catch((error) => {
        _handleFatalRedisError(error as Error, clientType, 'connection');
      });

    return redisClient;
  } catch (error) {
    return _handleFatalRedisError(error as Error, clientType, 'creation');
  }
};

const _handleFatalRedisError = (
  error: Error,
  clientType: RedisClientType,
  operation: string,
): never => {
  log.error({ REDIS_URL: process.env.REDIS_URL, clientType, error }, `Fatal Redis ${clientType} Error during ${operation}`);
  log.warn('Exiting process due to fatal Redis error');
  process.exit(1);
};
