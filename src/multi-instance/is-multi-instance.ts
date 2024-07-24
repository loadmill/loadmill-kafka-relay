import { getRedisClient } from '../redis/get-redis-client';

export const isMultiInstance = (): boolean => {
  return !!getRedisClient();
};
