import isEmpty from 'lodash/isEmpty';

import log from '../../log';
import {
  ConsumedMessage,
  ConsumeQueryOptions,
} from '../../types';

export const findMessageByRegex = (
  messages: ConsumedMessage[],
  options: ConsumeQueryOptions,
): ConsumedMessage[] | undefined => {
  const { headerRegex, valueRegex, multiple } = options;
  if (headerRegex || valueRegex) {
    messages = filterMessages(messages, { headerRegex, multiple, valueRegex });
  }
  return getLatestNMessages(messages, multiple);
};

export const filterMessages = (
  messages: ConsumedMessage[],
  options: ConsumeQueryOptions,
): ConsumedMessage[] => {
  log.debug({ messages }, 'Filtering messages by regex');

  return messages.filter((message) => isMessageMatchesConsumeFilters(message, options));
};

export const isMessageMatchesConsumeFilters = (
  message: ConsumedMessage,
  { headerRegex, valueRegex }: ConsumeQueryOptions,
): boolean => {
  const valueAsString = String(message.value || '');
  const valueMatch = valueRegex?.test(valueAsString);
  const headerMatch = headerRegex ? hasMatchingHeader(message.headers, headerRegex) : false;
  return Boolean(valueMatch || headerMatch);
};

const hasMatchingHeader = (
  headers: { [key: string]: string | undefined } | undefined,
  regex: RegExp,
): boolean => {
  if (isEmpty(headers)) {
    return false;
  }
  return Object.values(headers).some((value) => value && regex.test(value));
};

const getLatestNMessages = (
  messages: ConsumedMessage[],
  n: number = 1,
): ConsumedMessage[] | undefined => {
  if (messages.length > 0) {
    return n >= messages.length ?
      messages :
      messages.slice(messages.length - n, messages.length);
  }
};
