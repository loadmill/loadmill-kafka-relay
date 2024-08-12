import { getRedisClient } from '../../redis/redis-client';
import { ConsumedMessage } from '../../types';

import { toMessagesKey } from './redis-keys';

export const getMessagesFromRedis = async (subscriberId: string): Promise<ConsumedMessage[]> => {
  const serializedMessages = await getRedisClient().lRange(toMessagesKey(subscriberId), 0, -1);
  try {
    const messages = serializedMessages.map(
      (message: string) => JSON.parse(message) as ConsumedMessage,
    );
    return messages;
  } catch (e) {
    return [];
  }
  return [];
};
