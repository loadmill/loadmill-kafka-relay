import { ClientError } from '../errors';
import log from '../log';
import { ConsumeOptions } from '../types';

import { getConnection } from './connections';

const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

export const consume = async ({ id, regexFilter, timeout }: ConsumeOptions): Promise<string> => {
  const res = await getMessageOrTimeout(
    getConnection(id).messages,
    {
      regexFilter,
      timeout,
    },
  );
  if (!res) {
    let msg = 'No message found. ';
    msg += regexFilter ?
      'Maybe your regex filter is too restrictive?' :
      'Maybe the topic you provided when subscribing is not spelled correctly?';
    throw new ClientError(404, msg);
  }
  return res;
};

const getMessageOrTimeout = async (
  messages: string[],
  {
    regexFilter,
    timeout,
  }: MessageOrTimeoutOptions,
): Promise<string | undefined> => {
  const startTime = Date.now();
  let res;
  let elapsedTime = 0;
  const timeoutMs = timeout ? timeout * SECOND_MS : MAX_QUERY_TIME_MS;

  while (!res && elapsedTime < timeoutMs) {
    res = findMessageByRegex(messages, regexFilter);
    if (res) {
      break;
    }

    await delay(WAIT_INTERVAL_MS);
    elapsedTime = Date.now() - startTime;
  }
  return res;
};

type MessageOrTimeoutOptions = Pick<ConsumeOptions, 'regexFilter' | 'timeout'>;

const findMessageByRegex = (messages: string[], regexFilter?: string): string | undefined => {
  if (regexFilter) {
    messages = filterMessages(messages, regexFilter);
  }
  return getLatestMessage(messages);
};

const filterMessages = (messages: string[], regexFilter: string) => {
  log.debug({ messages, regexFilter }, 'Filtering messages by regex');
  const regex = new RegExp(regexFilter);
  const filteredMessages = messages.filter((message) => regex.test(message));
  messages = filteredMessages;
  return messages;
};

const getLatestMessage = (messages: string[]): string | undefined => {
  if (messages.length > 0) {
    return messages[messages.length - 1].toString();
  }
};

const delay = (timeout: number): Promise<unknown> => {
  return new Promise(resolve => setTimeout(resolve, timeout));
};
