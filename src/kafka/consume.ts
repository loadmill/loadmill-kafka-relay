import isEmpty from 'lodash/isEmpty';

import { TRUE_AS_STRING_VALUES } from '../constants';
import { ClientError } from '../errors';
import log from '../log';
import { ConsumedMessage, ConsumeOptions, ConsumeParams } from '../types';

import { getMessages } from './subscribers';

const BATCH_SIZE = Number(process.env.CONSUME_BATCH_SIZE) || 100;
const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

type FilterRegexOptions = {
  headerRegex: RegExp | null;
  valueRegex: RegExp | null;
};

type ConsumeQueryOptions = FilterRegexOptions & {
  multiple?: number;
};

type MessageOrTimeoutOptions = ConsumeQueryOptions & {
  timeout?: number;
};

export const consume = async (
  { id }: ConsumeParams,
  { headerValueRegexFilter, multiple, regexFilter, text, timeout }: ConsumeOptions,
): Promise<ConsumedMessage[]> => {
  const headerRegex = headerValueRegexFilter ? new RegExp(headerValueRegexFilter) : null;
  const valueRegex = regexFilter ? new RegExp(regexFilter) : null;
  const options: MessageOrTimeoutOptions = { headerRegex, multiple, timeout, valueRegex };

  const res = await getMessagesOrTimeout(id, options);
  if (!res) {
    let msg = 'No message found. ';
    msg += regexFilter ?
      'Maybe your regex filter is too restrictive?' :
      'Maybe the topic you provided when subscribing is either empty or not spelled correctly?';
    throw new ClientError(404, msg);
  }
  return handleTextOption(res, text);
};

const getMessagesOrTimeout = async (
  subscriberId: string,
  options: MessageOrTimeoutOptions,
): Promise<ConsumedMessage[] | undefined> => {
  const { timeout } = options;
  const startTime = Date.now();
  const timeoutMs = timeout ? timeout * SECOND_MS : MAX_QUERY_TIME_MS;

  while (Date.now() - startTime < timeoutMs) {
    const result = await scanForMatches(subscriberId, options);
    if (result) {
      return result;
    }
    await delay(WAIT_INTERVAL_MS);
  }
};

/**
 * Scans messages in batches for matches to the provided filters, starting from the newest messages (in tail).
 */
const scanForMatches = async (
  subscriberId: string,
  options: ConsumeQueryOptions,
): Promise<ConsumedMessage[] | undefined> => {
  const { headerRegex, valueRegex, multiple } = options;
  const maxMessages = Math.max(1, Number(multiple) || 1);
  const hasFilters = !!(headerRegex || valueRegex);

  if (!hasFilters) {
    const messages = await getMessages(subscriberId, maxMessages, 0);
    if (messages.length > 0) {
      return messages;
    }
    return;
  }

  const matches: ConsumedMessage[] = [];
  const previousBatch = new Set<string>();
  let offset = 0;

  while (matches.length < maxMessages) {
    const batch = await getMessages(subscriberId, BATCH_SIZE, offset);
    if (batch.length === 0) {
      break;
    }

    // Scan batch from newest to oldest, skipping overlaps
    for (let i = batch.length - 1; i >= 0 && matches.length < maxMessages; i--) {
      const message = batch[i];
      const serialized = JSON.stringify(message);

      if (previousBatch.has(serialized)) {
        continue; // overlap from async writes
      }

      if (isMessageMatchesConsumeFilters(message, { headerRegex, valueRegex })) {
        matches.push(message);
      }
    }

    // If we got fewer messages than requested, we've exhausted all messages
    if (batch.length < BATCH_SIZE) {
      break;
    }

    // Track this batch for overlap detection in next iteration
    previousBatch.clear();
    batch.forEach(m => previousBatch.add(JSON.stringify(m)));

    offset += batch.length;
  }

  // Return matches in chronological order (they were collected newest-first)
  if (matches.length > 0) {
    return matches.reverse();
  }
};

const isMessageMatchesConsumeFilters = (
  message: ConsumedMessage,
  { headerRegex, valueRegex }: FilterRegexOptions,
): boolean => {
  const valueAsString = String(message.value || '');
  const valueMatch = valueRegex?.test(valueAsString) ?? false;
  const headerMatch = headerRegex ? hasMatchingHeader(message.headers, headerRegex) : false;
  return valueMatch || headerMatch;
};

export const filterMessages = (
  messages: ConsumedMessage[],
  headerValueRegexFilter?: string,
  regexFilter?: string,
): ConsumedMessage[] => {
  log.debug({ messages, regexFilter }, 'Filtering messages by regex');

  const valueRegex = regexFilter ? new RegExp(regexFilter) : null;
  const headerRegex = headerValueRegexFilter ? new RegExp(headerValueRegexFilter) : null;

  return messages.filter((message) => {
    const valueAsString = String(message.value || '');
    const valueMatch = valueRegex?.test(valueAsString);
    const headerMatch = headerRegex ? hasMatchingHeader(message.headers, headerRegex) : false;
    return valueMatch || headerMatch;
  });
};

const hasMatchingHeader = (headers: { [key: string]: string | undefined } | undefined, regex: RegExp): boolean => {
  if (isEmpty(headers)) {
    return false;
  }
  return Object.values(headers).some((value) => value && regex.test(value));
};

const delay = (timeout: number): Promise<unknown> => {
  return new Promise(resolve => setTimeout(resolve, timeout));
};

export const isTruthyString = (value?: string): boolean => {
  return TRUE_AS_STRING_VALUES.some((b) => b === value);
};

const handleTextOption = (consumed: ConsumedMessage[], text?: string): ConsumedMessage[] => {
  const messages = [];
  if (isTruthyString(text)) {
    messages.push(...consumed);
  } else {
    for (const m of consumed) {
      try {
        const parsed = JSON.parse(m.value as string);
        messages.push({
          ...m,
          value: parsed,
        });
      } catch (e) {
        messages.push(m);
      }
    }
  }
  return messages;
};
