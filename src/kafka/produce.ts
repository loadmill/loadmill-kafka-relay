import { Kafka, Partitioners, RecordMetadata } from 'kafkajs';

import { APP_NAME } from '../constants';
import { ProduceOptions, ProduceParams } from '../types';

import { prepareBrokers } from './brokers';
import { kafkaLogCreator } from './log-creator';
import { encode } from './schema-registry';

export const produceMessage = async (
  { brokers, message, topic }: ProduceParams,
  { sasl, ssl }: ProduceOptions,
): Promise<RecordMetadata> => {
  const kafka = new Kafka({
    brokers: prepareBrokers(brokers),
    clientId: APP_NAME,
    logCreator: kafkaLogCreator,
    sasl,
    ssl,
  });
  const producer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner,
  });
  await producer.connect();
  const [recordMetaData] = await producer.send({
    messages: [
      { value: await encode(message) || JSON.stringify(message) },
    ],
    topic,
  });
  await producer.disconnect();
  return recordMetaData;
};
