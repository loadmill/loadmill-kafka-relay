import { ClientError } from '../errors';
import log from '../log';
import { ConsumeOptions, ConsumeParams, KafkaMessages } from '../types';

import { getConnection } from './connections';

const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

export const consume = async (
  { id }: ConsumeParams,
  { multiple, regexFilter, timeout }: ConsumeOptions,
): Promise<KafkaMessages> => {
  const res = await getMessagesOrTimeout(
    getConnection(id).messages,
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
  return res;
};

const getMessagesOrTimeout = async (
  messages: KafkaMessages,
  {
    multiple,
    regexFilter,
    timeout,
  }: MessageOrTimeoutOptions,
): Promise<KafkaMessages | undefined> => {
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

const findMessageByRegex = (messages: KafkaMessages, regexFilter?: string, multiple?: number): KafkaMessages | undefined => {
  if (regexFilter) {
    messages = filterMessages(messages, regexFilter);
  }
  return getLatestNMessages(messages, multiple);
};

const filterMessages = (messages: KafkaMessages, regexFilter: string) => {
  log.debug({ messages, regexFilter }, 'Filtering messages by regex');
  const regex = new RegExp(regexFilter);
  const filteredMessages = messages.filter((message) => regex.test(message.value || ''));
  messages = filteredMessages;
  return messages;
};

const getLatestNMessages = (messages: KafkaMessages, n: number = 1): KafkaMessages | undefined => {
  if (messages.length > 0) {
    return n >= messages.length ?
      messages :
      messages.slice(messages.length - n, messages.length);
  }
};

const delay = (timeout: number): Promise<unknown> => {
  return new Promise(resolve => setTimeout(resolve, timeout));
};
