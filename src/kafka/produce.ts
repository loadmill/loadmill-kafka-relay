import { Kafka, Partitioners, RecordMetadata } from 'kafkajs';

import { APP_NAME } from '../constants';
import { ProduceOptions, ProduceParams } from '../types';

import { prepareBrokers } from './brokers';
import { kafkaLogCreator } from './log-creator';
import {
  encode,
  getActiveSchemaId,
  setActiveSchemaId,
  setEncodeSchema,
} from './schema-registry';

export const produceMessage = async (
  { brokers, message, topic }: ProduceParams,
  { encode: encodeOptions, sasl, ssl }: ProduceOptions,
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

  const currentActiveSchemaId = getActiveSchemaId();
  if (encodeOptions) {
    await setEncodeSchema(encodeOptions);
  }

  const [recordMetaData] = await producer.send({
    messages: [
      { value: await encode(message) || JSON.stringify(message) },
    ],
    topic,
  });

  if (encodeOptions) {
    setActiveSchemaId(currentActiveSchemaId);
  }

  await producer.disconnect();
  return recordMetaData;
};
