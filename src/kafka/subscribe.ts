import { randomUUID } from 'crypto';

import { Consumer, Kafka, KafkaMessage, PartitionOffset } from 'kafkajs';

import { APP_NAME } from '../constants';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../types';

import { prepareBrokers } from './brokers';
import { addConnection } from './connections';
import { kafkaLogCreator } from './log-creator';
import { decode } from './schema-registry';

export const subscribe = async (
  { brokers, topic }: SubscribeParams,
  { sasl, ssl, timestamp }: SubscribeOptions,
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
  const partitions = await getPartitionsByTimestamp(kafka, topic, timestamp);
  await consumer.subscribe({ fromBeginning: false, topic });
  await consumer.run({
    eachMessage: async ({ message }) => {
      connection.messages.push(
        await fromKafkaToConsumedMessage(message),
      );
    },
  });
  await assignPartitions(consumer, partitions, topic);
  return { id };
};

const getPartitionsByTimestamp = async (
  kafka: Kafka,
  topic: string,
  timestamp = get1MinuteAgoTimestamp(),
): Promise<PartitionOffset[]> => {
  const admin = kafka.admin();
  await admin.connect();
  const partitions = await admin.fetchTopicOffsetsByTimestamp(topic, timestamp);
  await admin.disconnect();
  return partitions;
};

const get1MinuteAgoTimestamp = () => Date.now() - 60 * 1000;

const assignPartitions = async (consumer: Consumer, partitions: PartitionOffset[], topic: string) => {
  await Promise.all(
    partitions.map(({ partition, offset }) =>
      consumer.seek({ offset, partition, topic }),
    ),
  );
};

const fromKafkaToConsumedMessage = async (message: KafkaMessage): Promise<ConsumedMessage> => {
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
