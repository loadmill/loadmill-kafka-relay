
import { KafkaMessage } from '@confluentinc/kafka-javascript/types/kafkajs';

import { getRedisClient } from '../../redis/redis-client';
import { ConsumedMessage } from '../../types';
import { decode } from '../schema-registry';

import { toMessagesKey } from './redis-keys';

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

export const getMessagesFromRedis = async (subscriberId: string): Promise<ConsumedMessage[]> => {
  const serializedMessages = await getRedisClient().lRange(toMessagesKey(subscriberId), 0, -1);
  const messages = serializedMessages.map(
    (serializedMessageObject: string) => {
      const message = JSON.parse(serializedMessageObject) as ConsumedMessage;
      if (message.value && typeof message.value !== 'string') {
        message.value = JSON.stringify(message.value);
      }
      return message;
    },
  );
  return messages;
};
