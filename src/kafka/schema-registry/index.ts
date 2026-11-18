import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry';
import { ConfluentSchemaRegistryArgumentError } from '@kafkajs/confluent-schema-registry/dist/errors';
import { AvroDecimal } from '@ovotech/avro-decimal';

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

export const handleKafkaRegistryEnvVars = async (): Promise<void> => {
  if (process.env.LOADMILL_KAFKA_SCHEMA_REGISTRY_URL) {
    log.debug('Handling Kafka registry environment variables');
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
    await initSchemaRegistry(registryOptions);
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
    // IDs missing from the previous registry may exist in this one.
    clearMissingSchemaIds();
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
  // Only a Buffer can hold Avro: header values may be strings or arrays (a repeated header key), and
  // the registry throws "Invalid buffer" for them, which made the consumer retry the message forever.
  // Returning undefined lets the caller fall back to the value's string form.
  if (!Buffer.isBuffer(encodedValue)) {
    return undefined;
  }
  const schemaId = readSchemaId(encodedValue);
  const knownMissing = schemaId !== undefined ? missingSchemaIds.get(schemaId) : undefined;
  if (knownMissing && knownMissing.registry === schemaRegistry && knownMissing.expiresAt > Date.now()) {
    throw new UndecodableMessageError(schemaId, knownMissing.reason);
  }
  const registry = schemaRegistry;
  try {
    return await decodeConfirmingSchemaNotFound(encodedValue);
  } catch (error) {
    if (
      error instanceof ConfluentSchemaRegistryArgumentError &&
      error.message.includes('Message encoded with magic byte {"type":"Buffer","data":[')
      ||
      error instanceof Error &&
      error.message.includes('Attempt to access memory outside buffer bounds')
    ) {
      log.debug({ encodedValue: encodedValue.toString() }, 'Error decoding value, it probably wasnt encoded with schema.');
      log.debug(error);
    } else if (isSchemaNotFound(error)) {
      const reason = (error as Error).message;
      if (schemaId !== undefined) {
        missingSchemaIds.set(schemaId, { expiresAt: Date.now() + MISSING_SCHEMA_CACHE_MS, reason, registry });
      }
      throw new UndecodableMessageError(schemaId, reason);
    } else {
      throw error;
    }
  }
};

// A registry replica can answer 404 for a schema registered a moment ago on the leader, so a 404 is
// re-checked before the message is given up on. Once confirmed, the ID is remembered for a minute so
// a topic full of such messages is skipped without waiting on every one.
export const SCHEMA_NOT_FOUND_RECHECK_DELAYS_MS = [500, 1000];
const MISSING_SCHEMA_CACHE_MS = 60 * 1000;
// Scoped to the registry client that confirmed the miss: one swapped in by POST /registry starts clean.
const missingSchemaIds = new Map<number, { expiresAt: number; reason: string; registry: SchemaRegistry }>();

export const clearMissingSchemaIds = (): void => missingSchemaIds.clear();

const decodeConfirmingSchemaNotFound = async (encodedValue: Buffer): Promise<string | undefined> => {
  for (const delayMs of [...SCHEMA_NOT_FOUND_RECHECK_DELAYS_MS, undefined]) {
    try {
      return await schemaRegistry?.decode(encodedValue);
    } catch (error) {
      if (delayMs === undefined || !isSchemaNotFound(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

// Thrown when a message references a schema ID the registry does not have. Retrying cannot fix
// this, so consumers skip the message instead of re-reading it forever. Every other decode error
// (registry unreachable, 5xx, auth) is rethrown unchanged and still retried.
export class UndecodableMessageError extends Error {
  constructor(readonly schemaId: number | undefined, readonly reason: string) {
    super(reason);
    this.name = 'UndecodableMessageError';
  }
}

const isSchemaNotFound = (error: unknown): boolean =>
  error instanceof Error &&
  error.name === 'ResponseError' &&
  (error as Error & { status?: number }).status === 404;

// Confluent wire format: magic byte 0, then the schema ID as a 4-byte big-endian integer.
// Header values can be strings or arrays (repeated header keys), so only a Buffer can carry an ID.
export const readSchemaId = (encodedValue: unknown): number | undefined => {
  if (!Buffer.isBuffer(encodedValue) || encodedValue.length < 5 || encodedValue.readUInt8(0) !== 0) {
    return undefined;
  }
  return encodedValue.readInt32BE(1);
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

export const getSchemaRegistryData = async (): Promise<{ url: string } | undefined> => {
  try {
    if (schemaRegistry) {
      return {
        url: latestUrl,
      };
    }
  } catch (error) {
    log.error(error);
  }
};
