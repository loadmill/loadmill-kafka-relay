import { IHeaders, RecordMetadata } from '@confluentinc/kafka-javascript/types/kafkajs';

import { APP_NAME } from '../constants';
import log from '../log';
import {
  ConvertOption,
  EncodeProduceOptions,
  ProduceMessage,
  ProduceOptions,
  ProduceParams,
} from '../types';
import { Kafka } from '../types/kafkajs-confluent';

import { prepareBrokers } from './brokers';
import { compressionCodec } from './compression-codec';
import { convert } from './convert';
import { encodeHeaders } from './encode-headers';
import {
  encode,
} from './schema-registry';

export const produceMessage = async (
  { brokers, message, topic }: ProduceParams,
  options: ProduceOptions,
): Promise<RecordMetadata> => {
  const { connectionTimeout, sasl, ssl = false } = options;

  const kafka = new Kafka({
    kafkaJS: {
      brokers: prepareBrokers(brokers),
      clientId: APP_NAME,
      connectionTimeout,
      logger: log,
      ...(sasl && { sasl }),
      ssl,
    },
  });
  const producer = kafka.producer({
    kafkaJS: {
      ...(compressionCodec && { compression: compressionCodec }),
    },
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
  void convert(message.value, conversions);
  void convert(message.headers, conversions);
};

const prepareHeaders = async (
  headers: ProduceMessage['headers'],
  encodeOptions?: EncodeProduceOptions,
): Promise<IHeaders> => {
  await encodeHeaders(headers, encodeOptions);
  return headers as IHeaders;
};

const prepareValue = async (value: ProduceMessage['value'], encodeOptions?: EncodeProduceOptions) =>
  encodeOptions?.value ?
    await encode(value, encodeOptions?.value) as Buffer :
    JSON.stringify(value) as string;
