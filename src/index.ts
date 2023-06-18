import Fastify from 'fastify';
import { produceMessage } from './kafka/produce';
import { subscribe } from './kafka/subscribe';
import { consume } from './kafka/consume';
import { consumeValidationSchema, encodeValidationSchema, produceValidationSchema, registryValidationSchema, subscribeValidationSchema } from './server-validation';
import { ConsumeOptions, EncodeSchemaOptions, ProduceOptions, RegistryOptions, SubscribeOptions } from './types';
import log from './log';
import { initSchemaRegistry, setEncodeSchema } from './kafka/schema-registry';
import { injectEnvVars } from './inject-env';
import './on-start-app';
import { APP_NAME } from './constants';
import { getConnection } from './kafka/connections';
import { compile } from './server-validation/compilation';
import { serverErrorHandler } from './server-errors';

const app = Fastify({
  logger: log,
});

app.get('/', async (_, reply) => {
  reply.type('application/json').code(200)
  return { hello: `From ${APP_NAME}` };
});

app.post('/subscribe', {
  preValidation: injectEnvVars,
  schema: subscribeValidationSchema,
}, async (request, reply) => {
  const subscribeOptions = request.body as SubscribeOptions;
  const { id } = await subscribe(subscribeOptions);
  reply.type('application/json').code(200);
  return { id };
});

app.get('/consume/:id', { schema: consumeValidationSchema }, async (request, reply) => {
  const consumeOptions = {
    id: (request.params as { id: string }).id,
    regexFilter: (request.query as { filter?: string }).filter,
    timeout: (request.query as { timeout?: number }).timeout,
  } as ConsumeOptions;

  if (!getConnection(consumeOptions.id)) {
    reply.type('application/json').code(404);
    return { error: `No connection found for id ${consumeOptions.id}` };
  }
  const consumedMsg = await consume(consumeOptions);
  let message;
  try {
    message = JSON.parse(consumedMsg);
  } catch (e) {
    message = consumedMsg;
  }
  reply.type('application/json').code(200);
  return { message };
});

app.post('/produce', {
  preValidation: injectEnvVars,
  schema: produceValidationSchema,
}, async (request, reply) => {
  const producingOptions = request.body as ProduceOptions;
  const recordMetaData = await produceMessage(producingOptions);
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
