import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry';
import { AvroDecimal } from '@ovotech/avro-decimal';
import { CompressionCodecs, CompressionTypes } from 'kafkajs';
import LZ4 from 'kafkajs-lz4';

import { ClientError } from '../../errors';
import log from '../../log';
import { EncodeSchemaOptions, RegistryOptions } from '../../types';

let schemaRegistry: SchemaRegistry;
let activeSchemaId: number;
let latestUrl: string;

export const getActiveSchemaId = (): number => activeSchemaId;

export const setActiveSchemaId = (id: number): void => {
  log.info(`Setting active schema id to ${id}`);
  activeSchemaId = id;
};

export const handleKafkaRegistryEnvVars = (): void => {
  if (process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_URL) {
    const registryOptions: RegistryOptions = {
      url: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_URL,
    };
    if (process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME && process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD) {
      registryOptions.auth = {
        password: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD,
        username: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME,
      };
    }
    if (process.env.LOADMILL_KAFKA_SCHEMA_SUBJECT) {
      registryOptions.encode = {
        subject: process.env.LOADMILL_KAFKA_SCHEMA_SUBJECT,
      };
      if (process.env.LOADMILL_KAFKA_SCHEMA_VERSION) {
        registryOptions.encode.version = Number(process.env.LOADMILL_KAFKA_SCHEMA_VERSION);
      }
    }
    initSchemaRegistry(registryOptions);
  }
};

export const handleKafkaCompressionEnvVars = (): void => {
  if (process.env.LOADMILL_KAFKA_LZ4_COMPRESSION_CODEC) {
    CompressionCodecs[CompressionTypes.LZ4] = new LZ4().codec;
  }
};

export const initSchemaRegistry = async ({ url, auth, encode }: RegistryOptions): Promise<string> => {
  let message = 'Schema registry already initialized';
  if (url && url !== latestUrl) {
    message = `Initializing schema registry at ${url}`;
    schemaRegistry = new SchemaRegistry(
      { auth, host: url },
      { [SchemaType.AVRO]: {
        logicalTypes: { decimal: AvroDecimal },
      } },
    );
    log.info(message);
    latestUrl = url;
  }
  if (encode) {
    await setEncodeSchema(encode);
  }
  return message;
};

export const setEncodeSchema = async (encodeSchemaOptions: EncodeSchemaOptions): Promise<void> => {
  if (!schemaRegistry) {
    throw new ClientError(400, 'Schema registry not initialized. Hint: call POST /registry first');
  }
  const { subject, version } = encodeSchemaOptions;
  const activeSchemaId = await getSchemaRegistryId(subject, version);
  log.info(`Encode schema set. subject: ${subject}, version: ${version ? version.toString() : 'latest'}, Registry id: ${activeSchemaId}`);
};

export const decode = async (encodedValue: Buffer): Promise<string | undefined> => {
  try {
    return await schemaRegistry?.decode(encodedValue);
  } catch (error) {
    log.warn('Error decoding message');
    log.error(error);
  }
};

export const encode = async (value: unknown, options?: EncodeSchemaOptions): Promise<Buffer | undefined> => {
  if (options) {
    const { subject, version } = options;
    const registryId = await getSchemaRegistryId(subject, version);
    return await schemaRegistry?.encode(registryId, value);
  }
  if (activeSchemaId) {
    return await schemaRegistry?.encode(activeSchemaId, value);
  }
};

const getSchemaRegistryId = async (subject: string, version?: number | string): Promise<number> => {
  if (!schemaRegistry) {
    throw new ClientError(400, 'Schema registry not initialized. Hint: call POST /registry first');
  }
  if (version) {
    return await schemaRegistry.getRegistryId(subject, version);
  }
  return await schemaRegistry.getLatestSchemaId(subject);
};
