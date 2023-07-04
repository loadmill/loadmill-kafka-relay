import { randomUUID } from 'crypto';

import { Kafka } from 'kafkajs';

import { APP_NAME } from '../constants';
import { SubscribeOptions, SubscribeParams } from '../types';

import { prepareBrokers } from './brokers';
import { addConnection } from './connections';
import { kafkaLogCreator } from './log-creator';
import { decode } from './schema-registry';

export const subscribe = async (
  { brokers, topic }: SubscribeParams,
  { sasl, ssl }: SubscribeOptions
): Promise<{ id: string }> => {
  const kafka = new Kafka({
    brokers: prepareBrokers(brokers),
    clientId: APP_NAME,
    logCreator: kafkaLogCreator,
    sasl,
    ssl,
  });
  const id = randomUUID();
  const consumer = kafka.consumer({ groupId: id });
  const connection = addConnection(id, consumer, topic);
  await consumer.connect();
  await consumer.subscribe({ fromBeginning: true, topic });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const value = await decode(message.value as Buffer) || message.value?.toString() || '';

      connection.messages.push({
        ...message,
        value,
      });
    },
  });
  return { id };
};
