import { getRedisClient } from '../../redis/redis-client';
import { ConsumedMessage, ConsumeQueryOptions } from '../../types';
import { isMessageMatchesConsumeFilters } from '../consume/consume-query';

import { toMessagesKey } from './redis-keys';

const REDIS_SCAN_BATCH_SIZE = 100;

const parseConsumedMessage = (serializedMessageObject: string): ConsumedMessage => {
  const message = JSON.parse(serializedMessageObject) as ConsumedMessage;
  if (message.value && typeof message.value !== 'string') {
    message.value = JSON.stringify(message.value);
  }
  return message;
};

export const getMessagesFromRedis = async (
  subscriberId: string,
  options?: ConsumeQueryOptions,
): Promise<ConsumedMessage[]> => {
  const redisClient = getRedisClient();
  const messagesKey = toMessagesKey(subscriberId);
  const { headerRegex, valueRegex, multiple } = options ?? {};

  const desiredCount = Math.max(1, Number(multiple) || 1);

  const hasFilters = Boolean(headerRegex || valueRegex);
  if (!hasFilters) {
    const serializedTail = await redisClient.lRange(messagesKey, -desiredCount, -1);
    return serializedTail.map(parseConsumedMessage);
  }

  //filters exist => scan backwards in batches and stop early.
  const matchesNewestFirst: ConsumedMessage[] = [];
  const seenSerialized = new Set<string>();

  let offset = 0;
  while (matchesNewestFirst.length < desiredCount) {
    const start = -(offset + REDIS_SCAN_BATCH_SIZE);
    const stop = -(offset + 1);
    const serializedBatch = await redisClient.lRange(messagesKey, start, stop);
    if (serializedBatch.length === 0) {
      break;
    }

    // LRANGE returns oldest->newest for the requested range; iterate backwards.
    for (let i = serializedBatch.length - 1; i >= 0 && matchesNewestFirst.length < desiredCount; i -= 1) {
      const serialized = serializedBatch[i];
      if (seenSerialized.has(serialized)) {
        continue;
      }
      seenSerialized.add(serialized);

      const message = parseConsumedMessage(serialized);
      if (isMessageMatchesConsumeFilters(message, { headerRegex, valueRegex })) {
        matchesNewestFirst.push(message);
      }
    }

    offset += serializedBatch.length;
    if (serializedBatch.length < REDIS_SCAN_BATCH_SIZE) {
      break;
    }
  }

  return matchesNewestFirst.reverse();
};
