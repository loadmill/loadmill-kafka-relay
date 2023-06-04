import { config } from 'dotenv';

import { initSchemaRegistry } from './kafka/schema-registry';
import { startCloseOldConnectionsInterval } from './kafka/connections';
import { RegistryOptions } from './types';
import log from './log';
import { APP_NAME } from './constants';


log.info(`Starting ${APP_NAME}`);

log.info('Loading environment variables');
config();

log.info('Starting close old connections interval');
startCloseOldConnectionsInterval();

if (process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_URL) {
  const schemaRegistry: RegistryOptions = {
    url: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_URL,
  };
  if (process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME && process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD) {
    schemaRegistry.auth = {
      username: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME,
      password: process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD,
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
