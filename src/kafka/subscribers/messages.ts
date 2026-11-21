
import { KafkaMessage } from '@confluentinc/kafka-javascript/types/kafkajs';

import { getRedisClient } from '../../redis/redis-client';
import { ConsumedMessage } from '../../types';
import { decode } from '../schema-registry';

import { toTopicMessagesKey } from './redis-keys';

export const fromKafkaToConsumedMessage = async (message: KafkaMessage): Promise<ConsumedMessage> => {
  const decodedValue = await decode(message.value as Buffer);
  const stringifiedValue = message.value?.toString();
  const value = decodedValue || stringifiedValue || '';
  const key = message.key == null ? null : message.key.toString();
  const headers = {} as {
    [key: string]: string | undefined;
  };
  for (const [key, value] of Object.entries(message.headers || {})) {
    headers[key] = await decode(value as Buffer) || value?.toString();
  }

  return {
    ...message,
    headers,
    key,
    value,
  };
};

export const normalizeConsumedMessageValue = (value: ConsumedMessage['value']): unknown => {
  return typeof value === 'string' ?
    value :
    JSON.parse(value.toString());
};

export const parseSerializedMessage = (serialized: string): ConsumedMessage => {
  const message = JSON.parse(serialized) as ConsumedMessage;
  if (message.value && typeof message.value !== 'string') {
    message.value = JSON.stringify(message.value);
  }
  return message;
};

export const getMessagesFromRedis = async (
  topic: string,
  limit: number,
  offset: number,
): Promise<ConsumedMessage[]> => {
  const start = -(offset + limit);
  const stop = -(offset + 1);
  const serialized = await getRedisClient().zRange(toTopicMessagesKey(topic), start, stop);
  return serialized.map(parseSerializedMessage);
};
