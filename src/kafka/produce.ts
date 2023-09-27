import { IHeaders, Kafka, Partitioners, RecordMetadata } from 'kafkajs';

import { APP_NAME } from '../constants';
import {
  ConvertOption,
  EncodeProduceOptions,
  ProduceMessage,
  ProduceOptions,
  ProduceParams,
} from '../types';

import { prepareBrokers } from './brokers';
import { convert } from './convert';
import { encodeHeaders } from './encode-headers';
import { kafkaLogCreator } from './log-creator';
import {
  encode,
} from './schema-registry';

export const produceMessage = async (
  { brokers, message, topic }: ProduceParams,
  options: ProduceOptions,
): Promise<RecordMetadata> => {
  const { sasl, ssl } = options;

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
    messages: [await prepareProduceMessage(message, options)],
    topic,
  });

  await producer.disconnect();
  return recordMetaData;
};

const prepareProduceMessage = async (message: ProduceMessage, options: ProduceOptions) => {
  const { key, value, headers } = message;
  const { conversions, encode: encodeOptions } = options;

  if (conversions) {
    applyConversions(message, conversions);
  }

  return {
    headers: await prepareHeaders(headers, encodeOptions),
    key: key || null,
    value: await prepareValue(value, encodeOptions),
  };
};

const applyConversions = (message: ProduceMessage, conversions: ConvertOption[]) => {
  convert(message.value, conversions);
  convert(message.headers, conversions);
};

const prepareHeaders = async (
  headers: ProduceMessage['headers'],
  encodeOptions?: EncodeProduceOptions,
): Promise<IHeaders> => {
  await encodeHeaders(headers, encodeOptions);
  return headers;
};

const prepareValue = async (value: ProduceMessage['value'], encodeOptions?: EncodeProduceOptions) =>
  encodeOptions?.value ?
    await encode(value, encodeOptions?.value) as Buffer :
    JSON.stringify(value) as string;
