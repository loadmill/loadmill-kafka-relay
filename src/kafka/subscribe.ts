import { randomUUID } from 'crypto';
import { Kafka } from 'kafkajs';


import { APP_NAME } from '../constants';
import { SubscribeOptions } from '../types';

import { connections } from './connections';
import { prepareBrokers } from './brokers';
import { decode } from './schema-registry';

export const subscribe = async ({ brokers, sasl, ssl, topic }: SubscribeOptions): Promise<{ id: string }> => {
  const kafka = new Kafka({
    brokers: prepareBrokers(brokers),
    clientId: APP_NAME,
    sasl,
    ssl,
  });
  const id = randomUUID();
  const consumer = kafka.consumer({ groupId: id });
  connections[id] = {
    consumer,
    messages: [],
    topic,
    timeOfSubscription: Date.now(),
  };
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = await decode(message.value as Buffer) || message.value?.toString();
      connections[id].messages.push(value || '');
    },
  });
  return { id };
};
