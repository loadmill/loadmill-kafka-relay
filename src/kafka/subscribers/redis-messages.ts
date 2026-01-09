import log from '../../log';
import { getRedisClient } from '../../redis/redis-client';
import {
  ConsumedMessage,
  ConsumeQueryOptions,
  FilterRegexOptions,
} from '../../types';
import { isMessageMatchesConsumeFilters } from '../consume/consume-query';

import { toMessagesKey } from './redis-keys';

const REDIS_SCAN_BATCH_SIZE = 100;

/**
 * Redis list simulates a Kafka topic.
 * LRANGE returns (oldest → newest);
 * Use negative indices (LRANGE key -N -1) to start from tail.
 * Scan in reverse to get (newest → oldest).
 * Avoid duplicates / overlap across batches in case list is modified during scan.
 */
export const getMessagesFromRedis = async (
  subscriberId: string,
  options?: ConsumeQueryOptions,
): Promise<ConsumedMessage[]> => {
  log.info('In getMessagesFromRedis', { options, subscriberId });
  const messagesKey = toMessagesKey(subscriberId);
  const { headerRegex, multiple, valueRegex } = options ?? {};
  const maxMessages = Math.max(1, Number(multiple) || 1);

  log.info({ maxMessages, messagesKey });

  const noFilters = !headerRegex && !valueRegex;
  if (noFilters) {
    log.info('No filters, fetching tail messages only');
    return _fetchTailMessages(messagesKey, maxMessages);
  }

  log.info('Filters detected, fetching filtered messages', { headerRegex: headerRegex?.toString(), valueRegex: valueRegex?.toString() });
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
  const serializedTail = await getRedisClient().lRange(messagesKey, -maxMessagesToFetch, -1);
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
  return await getRedisClient().lRange(messagesKey, start, stop);
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
      log.info('Found overlap with previous batch, skipping to avoid duplicates', { serialized });
      return;
    }

    const message = _parseSerializedMessage(serialized);
    if (isMessageMatchesConsumeFilters(message, filters)) {
      log.info('Message matches filters, adding to results', { message });
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
    log.info('Fetching batch from Redis', { offset });
    const serializedBatch = await _fetchBatchFromRedis(messagesKey, offset);
    log.info('Fetched batch', { batchSize: serializedBatch.length });
    if (serializedBatch.length === 0) {
      break;
    }

    log.info('Collecting matching messages from batch');
    _collectMatchingMessagesInReverse(serializedBatch, filters, state);

    log.info('Updating previous batch for next iteration');
    state.previousBatch = new Set(serializedBatch);

    offset += serializedBatch.length;

    if (_isEndOfMessages(serializedBatch.length)) {
      log.info('Reached end of messages in Redis', { batchSize: serializedBatch.length });
      break;
    }
  }

  return state.matches.reverse();
};

const _isEndOfMessages = (batchSize: number): boolean => {
  return batchSize === 0 || batchSize < REDIS_SCAN_BATCH_SIZE;
};
