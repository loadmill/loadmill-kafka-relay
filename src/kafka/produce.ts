import { Kafka, Partitioners, RecordMetadata } from 'kafkajs';

import { APP_NAME } from '../constants';
import { ClientError } from '../errors';
import { ProduceMessage, ProduceOptions, ProduceParams } from '../types';

import { prepareBrokers } from './brokers';
import { convert } from './convert';
import { kafkaLogCreator } from './log-creator';
import {
  encode,
  getActiveSchemaId,
  setActiveSchemaId,
  setEncodeSchema,
} from './schema-registry';

export const produceMessage = async (
  { brokers, message, topic }: ProduceParams,
  { conversions, encode: encodeOptions, sasl, ssl }: ProduceOptions,
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

  if (conversions) {
    if (typeof message !== 'object') {
      throw new ClientError(400, 'Message must be an object when conversions are provided');
    }
    convert(message, conversions);
  }

  const [recordMetaData] = await producer.send({
    messages: [await prepareProduceMessage(message)],
    topic,
  });

  if (encodeOptions) {
    setActiveSchemaId(currentActiveSchemaId);
  }

  await producer.disconnect();
  return recordMetaData;
};

const prepareProduceMessage = async (message: ProduceMessage) => {
  const { key, value, headers } = message;
  return {
    headers,
    key,
    value: await encode(value) || JSON.stringify(value),
  };
};
