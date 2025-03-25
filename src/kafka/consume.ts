import { TRUE_AS_STRING_VALUES } from '../constants';
import { ClientError } from '../errors';
import log from '../log';
import { ConsumedMessage, ConsumeOptions, ConsumeParams } from '../types';

import { getMessages } from './subscribers';

const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

export const consume = async (
  { id }: ConsumeParams,
  { multiple, regexFilter, text, timeout }: ConsumeOptions,
): Promise<ConsumedMessage[]> => {
  const res = await getMessagesOrTimeout(
    await getMessages(id),
    {
      multiple,
      regexFilter,
      timeout,
    },
  );
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
  messages: ConsumedMessage[],
  {
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
    res = findMessageByRegex(messages, regexFilter, multiple);
    if (res) {
      break;
    }

    await delay(WAIT_INTERVAL_MS);
    elapsedTime = Date.now() - startTime;
  }
  return res;
};

type MessageOrTimeoutOptions = Pick<ConsumeOptions, 'multiple' | 'regexFilter' | 'timeout'>;

const findMessageByRegex = (messages: ConsumedMessage[], regexFilter?: string, multiple?: number): ConsumedMessage[] | undefined => {
  if (regexFilter) {
    messages = filterMessages(messages, regexFilter);
  }
  return getLatestNMessages(messages, multiple);
};

const filterMessages = (messages: ConsumedMessage[], regexFilter: string) => {
  log.debug({ messages, regexFilter }, 'Filtering messages by regex');
  const regex = new RegExp(regexFilter);
  const filteredByHeader = filterByHeaders(regex, messages);
  const filteredMessages = messages.filter((message) => regex.test(message.value || ''));
  messages = filteredMessages.concat(filteredByHeader);
  return messages;
};
const filterByHeaders = (regex: RegExp, messages: ConsumedMessage[]): ConsumedMessage[] =>  {
  return messages.filter((message) => {
    if (!message.headers || Object.keys(message.headers).length === 0) {
      return false;
    }
     else  return hasMatchingHeader(message.headers, regex)
  });
}
const hasMatchingHeader= (headers: { [key: string]: string | undefined }, regex: RegExp): boolean {
  Object.keys(headers).some((key) => {
    const value = headers[key];
    return typeof value === 'string' && regex.test(value);
  });
}

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
