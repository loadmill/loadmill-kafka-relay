import Fastify from 'fastify';

import { APP_NAME } from './constants';
import { ClientError } from './errors';
import { injectEnvVars } from './inject-env';
import { getConnectionTimeout } from './kafka/connection-timeout';
import { consume } from './kafka/consume';
import { getDebugData } from './kafka/debug';
import { produceMessage } from './kafka/produce';
import { initSchemaRegistry, setEncodeSchema } from './kafka/schema-registry';
import { subscribe } from './kafka/subscribe';
import {
  isSubscriberExists,
  removeSubscriber,
} from './kafka/subscribers';
import { pinoLogger } from './log/pino-logger';
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
  logger: pinoLogger,
});

app.get('/', async () => {
  return { hello: `From ${APP_NAME}` };
});

app.post('/subscribe', {
  preValidation: injectEnvVars,
  schema: subscribeValidationSchema,
}, async (request) => {
  const { brokers, connectionTimeout, topic, sasl, ssl, timestamp } = request.body as SubscribeParams & SubscribeOptions;
  const { id } = await subscribe(
    { brokers, topic },
    {
      connectionTimeout: getConnectionTimeout(connectionTimeout),
      sasl,
      ssl,
      timestamp,
    },
  );
  return { id };
});

// unsubscribe
app.delete('/subscriptions/:id', async (request) => {
  const { id } = request.params as { id: string };

  if (!(await isSubscriberExists(id))) {
    throw new ClientError(404, `No subscriber found for id ${id}`);
  }

  await removeSubscriber(id);

  return { id };
});

app.get('/consume/:id', { schema: consumeValidationSchema }, async (request) => {
  const { id } = request.params as { id: string };

  const { headerFilter: headerValueRegexFilter, filter: regexFilter, multiple, text, timeout } = request.query as {
    filter?: string; headerFilter?: string; multiple?: number; text?: string; timeout?: number;
  };
  const consumeOptions = {
    headerValueRegexFilter,
    multiple,
    regexFilter,
    text,
    timeout,
  } as ConsumeOptions;

  if (!(await isSubscriberExists(id))) {
    throw new ClientError(404, `No subscriber found for id ${id}`);
  }

  const messages = await consume({ id }, consumeOptions);

  return {
    messages,
  };
});

app.post('/produce', {
  preValidation: injectEnvVars,
  schema: produceValidationSchema,
}, async (request) => {
  const { brokers, connectionTimeout, conversions, encode, message, topic, sasl, ssl } = request.body as ProduceParams & ProduceOptions;
  const recordMetaData = await produceMessage(
    { brokers, message, topic },
    {
      connectionTimeout: getConnectionTimeout(connectionTimeout),
      conversions,
      encode,
      sasl,
      ssl,
    },
  );
  return recordMetaData;
});

app.post('/registry', {
  preValidation: injectEnvVars,
  schema: registryValidationSchema,
}, async (request) => {
  const registryOptions = request.body as RegistryOptions;
  const message = await initSchemaRegistry(registryOptions);
  return { message };
});

app.put('/registry/encode', {
  preValidation: injectEnvVars,
  schema: encodeValidationSchema,
}, async (request) => {
  const encodeSchemaOptions = request.body as EncodeSchemaOptions;
  await setEncodeSchema(encodeSchemaOptions);
  return { message: 'Schema registry encode schema set successfully' };
});

app.get('/debug', async () => {
  const debugData = await getDebugData();
  return debugData;
});

app.setValidatorCompiler(compile);

app.setErrorHandler(serverErrorHandler);

void app.listen({
  host: '0.0.0.0',
  port: Number(process.env.LOADMILL_KAFKA_SERVER_PORT) || 3000,
});
