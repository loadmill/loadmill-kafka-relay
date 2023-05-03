import log from '../log';
import { ConsumeOptions, Subscriber } from '../types';
import { connections } from './connections';

const SECOND_MS = 1000;
const MAX_QUERY_TIME_MS = 25 * SECOND_MS;
const WAIT_INTERVAL_MS = 2 * SECOND_MS;

export const consume = async ({ id, regexFilter }: ConsumeOptions): Promise<string> => {
  const res = await getMessageOrTimeout(connections[id].messages, regexFilter);
  if (!res) {
    throw new Error('No messages found');
  }
  return res;
}

const getMessageOrTimeout = async (messages: string[], regexFilter?: string): Promise<string | undefined> => {
  const startTime = Date.now();
  let res;
  let elapsedTime = 0;

  while (!res && elapsedTime < MAX_QUERY_TIME_MS) {
    res = findMessageByRegex(messages, regexFilter);
    if (res) {
      break;
    }

    await delay(WAIT_INTERVAL_MS);
    elapsedTime = Date.now() - startTime;
  }
  return res;
}

const findMessageByRegex = (messages: string[], regexFilter?: string): string | undefined => {
  if (regexFilter) {
    messages = filterMessages(messages, regexFilter);
  }
  return getLatestMessage(messages);
};

const filterMessages = (messages: string[], regexFilter: string) => {
  const regex = new RegExp(regexFilter);
  const filteredMessages = messages.filter((message) => regex.test(message));
  messages = filteredMessages;
  return messages;
};

const getLatestMessage = (messages: string[]): string | undefined => {
  if (messages.length > 0) {
    return messages[messages.length - 1].toString();
  }
}

const delay = (timeout: number): Promise<unknown> => {
  return new Promise(resolve => setTimeout(resolve, timeout));
}
