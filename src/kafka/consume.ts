import isEmpty from 'lodash/isEmpty';

import { TRUE_AS_STRING_VALUES } from '../constants';
import { ClientError } from '../errors';
import log from '../log';
import { ConsumedMessage, ConsumeOptions, ConsumeParams } from '../types';

import { getMessages, getSkippedMessages } from './subscribers';
import { describeSkippedMessages } from './subscribers/undecodable-messages';

const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

export const consume = async (
  { id }: ConsumeParams,
  { headerValueRegexFilter, multiple, regexFilter, text, timeout }: ConsumeOptions,
): Promise<ConsumedMessage[]> => {
  const res = await getMessagesOrTimeout(
    () => getMessages(id),
    {
      headerValueRegexFilter,
      multiple,
      regexFilter,
      timeout,
    },
  );
  if (!res) {
    throw new ClientError(404, await noMessageFoundReason(id, regexFilter));
  }
  return handleTextOption(res, text);
};

// When undecodable messages were skipped, they are the likely reason, so name them instead of
// pointing the test author at their filter.
export const noMessageFoundReason = async (id: string, regexFilter?: string): Promise<string> => {
  const skipped = describeSkippedMessages(await getSkippedMessages(id));
  if (skipped) {
    return `No message found. ${skipped}`;
  }
  return 'No message found. ' + (regexFilter ?
    'Maybe your regex filter is too restrictive?' :
    'Maybe the topic you provided when subscribing is either empty or not spelled correctly?');
};

const getMessagesOrTimeout = async (
  getMessages: () => Promise<ConsumedMessage[]> | ConsumedMessage[],
  {
    headerValueRegexFilter,
    multiple,
    regexFilter,
    timeout,
  }: MessageOrTimeoutOptions,
): Promise<ConsumedMessage[] | undefined> => {
  const startTime = Date.now();
  let res;
  let elapsedTime = 0;
  const timeoutMs = timeout ? timeout * SECOND_MS : MAX_QUERY_TIME_MS;

  while (!res && elapsedTime < timeoutMs) {
    const messages = await getMessages();
    res = findMessageByRegex(messages, headerValueRegexFilter, regexFilter, multiple);
    if (res) {
      break;
    }

    await delay(WAIT_INTERVAL_MS);
    elapsedTime = Date.now() - startTime;
  }
  return res;
};

type MessageOrTimeoutOptions = Pick<ConsumeOptions, 'headerValueRegexFilter' | 'multiple' | 'regexFilter' | 'timeout'>;

const findMessageByRegex = (messages: ConsumedMessage[], headerValueRegexFilter?:string, regexFilter?: string, multiple?: number): ConsumedMessage[] | undefined => {
  if (regexFilter || headerValueRegexFilter) {
    messages = filterMessages(messages, headerValueRegexFilter, regexFilter);
  }
  return getLatestNMessages(messages, multiple);
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

const getLatestNMessages = (messages: ConsumedMessage[], n: number = 1): ConsumedMessage[] | undefined => {
  if (messages.length > 0) {
    return n >= messages.length ?
      messages :
      messages.slice(messages.length - n, messages.length);
  }
};

const delay = (timeout: number): Promise<unknown> => {
  return new Promise(resolve => setTimeout(resolve, timeout));
};

export const isTruthyString = (value?: string): boolean => {
  return TRUE_AS_STRING_VALUES.some((b) => b === value);
};

const handleTextOption = (consumed: ConsumedMessage[], text?: string ): ConsumedMessage[] => {
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
