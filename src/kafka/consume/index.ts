import { TRUE_AS_STRING_VALUES } from '../../constants';
import { ClientError } from '../../errors';
import {
  ConsumedMessage,
  ConsumeOptions,
  ConsumeParams,
  MessageOrTimeoutOptions,
} from '../../types';
import { getMessages } from '../subscribers';

import { findMessageByRegex } from './consume-query';

const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

export const consume = async (
  { id }: ConsumeParams,
  { headerValueRegexFilter, multiple, regexFilter, text, timeout }: ConsumeOptions,
): Promise<ConsumedMessage[]> => {
  const headerRegex = headerValueRegexFilter ? new RegExp(headerValueRegexFilter) : null;
  const valueRegex = regexFilter ? new RegExp(regexFilter) : null;
  const options = {
    headerRegex,
    multiple,
    timeout,
    valueRegex,
  };

  const res = await getMessagesOrTimeout(
    () => getMessages(id, options),
    options,
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
  getMessagesCallback: () => Promise<ConsumedMessage[]> | ConsumedMessage[],
  options: MessageOrTimeoutOptions,
): Promise<ConsumedMessage[] | undefined> => {
  const { timeout } = options;
  const startTime = Date.now();
  let res;
  let elapsedTime = 0;
  const timeoutMs = timeout ? timeout * SECOND_MS : MAX_QUERY_TIME_MS;

  while (!res && elapsedTime < timeoutMs) {
    const messages = await getMessagesCallback();
    res = findMessageByRegex(messages, options);
    if (res) {
      break;
    }

    await delay(WAIT_INTERVAL_MS);
    elapsedTime = Date.now() - startTime;
  }
  return res;
};

const delay = (timeout: number): Promise<unknown> => {
  return new Promise(resolve => setTimeout(resolve, timeout));
};

const isTruthyString = (value?: string): boolean => {
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
