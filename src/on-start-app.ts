import { config } from 'dotenv';
import { CompressionCodecs, CompressionTypes } from 'kafkajs';
import LZ4 from 'kafkajs-lz4';

import { APP_NAME } from './constants';
import { startCloseOldConnectionsInterval } from './kafka/connections';
import { initSchemaRegistry } from './kafka/schema-registry';
import log from './log';
import { RegistryOptions } from './types';

log.info(`Starting ${APP_NAME}`);

log.info('Loading environment variables');
config();

log.info('Starting close old connections interval');
startCloseOldConnectionsInterval();

if (process.env.LOADMILL_KAFKA_LZ4_COMPRESSION_CODEC) {
  CompressionCodecs[CompressionTypes.LZ4] = new LZ4().codec;
}

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
