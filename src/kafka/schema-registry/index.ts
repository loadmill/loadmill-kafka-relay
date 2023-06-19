import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';

import log from '../../log';
import { EncodeSchemaOptions, RegistryOptions } from '../../types';

let schemaRegistry: SchemaRegistry;
let activeSchemaId: number;
let latestUrl: string;

export const initSchemaRegistry = async ({ url, auth, encode }: RegistryOptions): Promise<string> => {
  let message = 'Schema registry already initialized';
  if (url && url !== latestUrl) {
    message = `Initializing schema registry at ${url}`;
    schemaRegistry = new SchemaRegistry({ auth, host: url });
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
    throw new Error('Schema registry not initialized. Hint: call POST /registry first');
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

export const encode = async (value: string | object): Promise<Buffer | undefined> => {
  if (activeSchemaId) {
    return await schemaRegistry?.encode(activeSchemaId, value);
  }
};

export const getActiveSchemaId = (): number => {
  return activeSchemaId;
};
export const asd = (): 'asd' => {
  return 'asd';
};
