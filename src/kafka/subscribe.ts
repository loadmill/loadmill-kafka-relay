import { randomUUID } from 'crypto';

import { Kafka, KafkaMessage } from 'kafkajs';

import { APP_NAME } from '../constants';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../types';

import { prepareBrokers } from './brokers';
import { kafkaLogCreator } from './log-creator';
import { decode } from './schema-registry';
import { addSubscription } from './subscriptions';

export const subscribe = async (
  { brokers, topic }: SubscribeParams,
  { sasl, ssl }: SubscribeOptions,
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
  const subscription = addSubscription(id, consumer, topic);
  await consumer.connect();
  await consumer.subscribe({ fromBeginning: true, topic });
  await consumer.run({
    eachMessage: async ({ message }) => {
      subscription.messages.push(
        await fromKafkaToConsumedMessage(message),
      );
    },
  });
  return { id };
};

const fromKafkaToConsumedMessage = async (message: KafkaMessage): Promise<ConsumedMessage> => {
  const value = await decode(message.value as Buffer) || message.value?.toString() || '';
  const key = message.key == null ? null : message.key.toString();
  const headers = Object.entries(message.headers || {}).reduce((acc, [key, value]) => {
    acc[key] = value?.toString();
    return acc;
  }, {} as { [key: string]: string | undefined });

  return {
    ...message,
    headers,
    key,
    value,
  };
};
