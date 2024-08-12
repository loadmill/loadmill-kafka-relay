import { getRedisClient } from '../redis/redis-client';

export const isMultiInstance = (): boolean => {
  return !!getRedisClient();
};
