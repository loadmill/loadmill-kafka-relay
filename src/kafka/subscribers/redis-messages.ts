import log from '../../log';
import { getRedisClient } from '../../redis/redis-client';
import {
  ConsumedMessage,
  ConsumeQueryOptions,
  FilterRegexOptions,
} from '../../types';
import { isMessageMatchesConsumeFilters } from '../consume/consume-query';

import { toTopicMessagesKey } from './redis-keys';

const REDIS_SCAN_BATCH_SIZE = Number(process.env.REDIS_SCAN_BATCH_SIZE) || 100;

/**
 * Redis sorted set stores topic messages ordered by timestamp.
 * ZRANGE returns (oldest → newest);
 * Use negative indices (ZRANGE key -N -1) to start from tail.
 * Scan in reverse to get (newest → oldest).
 * Avoid duplicates / overlap across batches in case set is modified during scan.
 */
export const getMessagesFromRedis = async (
  topic: string,
  options?: ConsumeQueryOptions,
): Promise<ConsumedMessage[]> => {
  const messagesKey = toTopicMessagesKey(topic);
  const { headerRegex, multiple, valueRegex } = options ?? {};
  const maxMessages = Math.max(1, Number(multiple) || 1);

  log.debug({ maxMessages, messagesKey });

  const noFilters = !headerRegex && !valueRegex;
  if (noFilters) {
    log.debug('No filters, fetching tail messages only');
    return _fetchTailMessages(messagesKey, maxMessages);
  }

  log.debug('Filters detected, fetching filtered messages', { headerRegex: headerRegex?.toString(), valueRegex: valueRegex?.toString() });
  return await _fetchFilteredMessages(
    messagesKey,
    maxMessages,
    { headerRegex, valueRegex },
  );
};

const _fetchTailMessages = async (
  messagesKey: string,
  maxMessagesToFetch: number,
): Promise<ConsumedMessage[]> => {
  const serializedTail = await getRedisClient().zRange(messagesKey, -maxMessagesToFetch, -1);
  return serializedTail.map(_parseSerializedMessage);
};

const _parseSerializedMessage = (serializedMessageObject: string): ConsumedMessage => {
  const message = JSON.parse(serializedMessageObject) as ConsumedMessage;
  if (message.value && typeof message.value !== 'string') {
    message.value = JSON.stringify(message.value);
  }
  return message;
};

const _fetchBatchFromRedis = async (
  messagesKey: string,
  offset: number,
): Promise<string[]> => {
  const { start, stop } = _calculateBatchRange(offset);
  return await getRedisClient().zRange(messagesKey, start, stop);
};

const _calculateBatchRange = (offset: number) => {
  const start = -(offset + REDIS_SCAN_BATCH_SIZE);
  const stop = -(offset + 1);
  return { start, stop };
};

type MessageFetchState = {
  matches: ConsumedMessage[];
  maxMatches: number;
  previousBatch: Set<string>; // to avoid duplicates across batches if list is modified
};

const _collectMatchingMessagesInReverse = (
  serializedBatch: string[],
  filters: FilterRegexOptions,
  state: MessageFetchState,
): void => {
  for (let i = serializedBatch.length - 1; i >= 0 && state.matches.length < state.maxMatches; i -= 1) {

    const serialized = serializedBatch[i];

    if (state.previousBatch.has(serialized)) {
      log.debug('Found overlap with previous batch, skipping to avoid duplicates',
        {
          matchesFound: state.matches.length,
          previousBatchSize: state.previousBatch.size,
          serializedLength: serialized.length,
        },
      );
      continue;
    }

    const message = _parseSerializedMessage(serialized);
    if (isMessageMatchesConsumeFilters(message, filters)) {
      log.debug('Message matches filters, adding to results', { message: { ...message, value: '[REDACTED]' } });
      state.matches.push(message);
    }
  }
};

const _fetchFilteredMessages = async (
  messagesKey: string,
  maxMatches: number,
  filters: FilterRegexOptions,
): Promise<ConsumedMessage[]> => {
  const state: MessageFetchState = {
    matches: [],
    maxMatches,
    previousBatch: new Set<string>(),
  };

  let offset = 0;

  while (state.matches.length < maxMatches) {
    log.debug('Fetching batch from Redis', { offset });
    const serializedBatch = await _fetchBatchFromRedis(messagesKey, offset);
    log.debug('Fetched batch', { batchSize: serializedBatch.length });
    if (serializedBatch.length === 0) {
      break;
    }

    log.debug('Collecting matching messages from batch');
    _collectMatchingMessagesInReverse(serializedBatch, filters, state);

    log.debug('Updating previous batch for next iteration');
    state.previousBatch = new Set(serializedBatch);

    offset += serializedBatch.length;

    if (_isEndOfMessages(serializedBatch.length)) {
      log.debug('Reached end of messages in Redis', { batchSize: serializedBatch.length });
      break;
    }
  }

  return state.matches.reverse();
};

const _isEndOfMessages = (batchSize: number): boolean => {
  return batchSize === 0 || batchSize < REDIS_SCAN_BATCH_SIZE;
};
