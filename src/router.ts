import Fastify from 'fastify';

import { APP_NAME } from './constants';
import { ClientError } from './errors';
import { injectEnvVars } from './inject-env';
import { consume } from './kafka/consume';
import { produceMessage } from './kafka/produce';
import { initSchemaRegistry, setEncodeSchema } from './kafka/schema-registry';
import { subscribe } from './kafka/subscribe';
import { getSubscription } from './kafka/subscriptions';
import log from './log';
import { serverErrorHandler } from './server-errors';
import {
  consumeValidationSchema,
  encodeValidationSchema,
  produceValidationSchema,
  registryValidationSchema,
  subscribeValidationSchema,
} from './server-validation';
import { compile } from './server-validation/compilation';
import {
  ConsumeOptions,
  EncodeSchemaOptions,
  ProduceOptions,
  ProduceParams,
  RegistryOptions,
  SubscribeOptions,
  SubscribeParams,
} from './types';

const app = Fastify({
  logger: log,
});

app.get('/', async (_, reply) => {
  reply.type('application/json').code(200);
  return { hello: `From ${APP_NAME}` };
});

app.post('/subscribe', {
  preValidation: injectEnvVars,
  schema: subscribeValidationSchema,
}, async (request, reply) => {
  const { brokers, topic, sasl, ssl } = request.body as SubscribeParams & SubscribeOptions;
  const { id } = await subscribe({ brokers, topic }, { sasl, ssl });
  reply.type('application/json').code(200);
  return { id };
});

app.get('/consume/:id', { schema: consumeValidationSchema }, async (request, reply) => {
  const { id } = request.params as { id: string };

  const { filter: regexFilter, multiple, text, timeout } = request.query as { filter?: string; multiple?: number; text?: string; timeout?: number };
  const consumeOptions = {
    multiple,
    regexFilter,
    text,
    timeout,
  } as ConsumeOptions;

  if (!getSubscription(id)) {
    throw new ClientError(404, `No subscription found for id ${id}`);
  }

  const messages = await consume({ id }, consumeOptions);
  reply.type('application/json').code(200);

  return {
    messages,
  };
});

app.post('/produce', {
  preValidation: injectEnvVars,
  schema: produceValidationSchema,
}, async (request, reply) => {
  const { brokers, conversions, encode, message, topic, sasl, ssl } = request.body as ProduceParams & ProduceOptions;
  const recordMetaData = await produceMessage({ brokers, message, topic }, { conversions, encode, sasl, ssl });
  reply.type('application/json').code(200);
  return recordMetaData;
});

app.post('/registry', {
  preValidation: injectEnvVars,
  schema: registryValidationSchema,
}, async (request, reply) => {
  const registryOptions = request.body as RegistryOptions;
  const message = await initSchemaRegistry(registryOptions);
  reply.type('application/json').code(200);
  return { message };
});

app.put('/registry/encode', {
  preValidation: injectEnvVars,
  schema: encodeValidationSchema,
}, async (request, reply) => {
  const encodeSchemaOptions = request.body as EncodeSchemaOptions;
  await setEncodeSchema(encodeSchemaOptions);
  reply.type('application/json').code(200);
  return { message: 'Schema registry encode schema set successfully' };
});

app.setValidatorCompiler(compile);

app.setErrorHandler(serverErrorHandler);

app.listen({
  host: '0.0.0.0',
  port: Number(process.env.LOADMILL_KAFKA_SERVER_PORT) || 3000,
});
