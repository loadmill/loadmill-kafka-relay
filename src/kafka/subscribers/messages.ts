import { KafkaMessage } from '@confluentinc/kafka-javascript/types/kafkajs';

import { ConsumedMessage } from '../../types';
import { decode } from '../schema-registry';

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
