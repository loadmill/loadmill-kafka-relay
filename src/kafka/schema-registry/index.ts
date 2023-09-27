import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry';
import { AvroDecimal } from '@ovotech/avro-decimal';
import { CompressionCodecs, CompressionTypes } from 'kafkajs';
import LZ4 from 'kafkajs-lz4';

import { ClientError } from '../../errors';
import log from '../../log';
import { Convertable, EncodeSchemaOptions, RegistryOptions } from '../../types';

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
    const schemaRegistry: RegistryOptions = {
      url: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_URL,
    };
    if (process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME && process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD) {
      schemaRegistry.auth = {
        password: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD,
        username: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME,
      };
    }
    if (process.env.LOADMILL_KAFKA_SCHEMA_SUBJECT) {
      schemaRegistry.encode = {
        subject: process.env.LOADMILL_KAFKA_SCHEMA_SUBJECT,
      };
      if (process.env.LOADMILL_KAFKA_SCHEMA_VERSION) {
        schemaRegistry.encode.version = Number(process.env.LOADMILL_KAFKA_SCHEMA_VERSION);
      }
    }
    initSchemaRegistry(schemaRegistry);
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
  log.info(`Setting encode schema with subject: ${subject}, version: ${version ? version.toString() : 'latest'}`);
  if (!version) {
    activeSchemaId = await schemaRegistry.getLatestSchemaId(subject);
  } else {
    activeSchemaId = await schemaRegistry.getRegistryId(subject, version);
  }
  log.info(`Active Schema id set to ${activeSchemaId}`);
};

export const decode = async (encodedValue: Buffer): Promise<string | undefined> => {
  return await schemaRegistry?.decode(encodedValue);
};

export const encode = async (value: string | Convertable): Promise<Buffer | undefined> => {
  if (activeSchemaId) {
    return await schemaRegistry?.encode(activeSchemaId, value);
  }
};
