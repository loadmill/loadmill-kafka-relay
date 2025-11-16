import { ConfluentSchemaRegistryError } from '@kafkajs/confluent-schema-registry/dist/errors';
import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { ClientError } from '../errors';
import { isKafkaJSError, KafkaJSError } from '../types/kafkajs-confluent';

type ErrorType = ClientError | FastifyError | ConfluentSchemaRegistryError | KafkaJSError;

type ResponseError = {
  message: string;
  name: string;
  stack?: string;
  status: number;
  unauthorized: boolean;
  url: string;
};

type PresentableError = {
  error: ErrorType & {
    message: string;
  };
};

export const serverErrorHandler = (
  error: ErrorType,
  request: FastifyRequest,
  reply: FastifyReply,
): PresentableError => {
  const { log } = request;
  log.error(error);
  let message = error.message || '¯\\_(ツ)_/¯ There was an error';
  const statusCode = (error as FastifyError).statusCode;

  if (error.name === 'ResponseError') {
    void reply.code((error as ResponseError).status);
    message = (error as ResponseError).message;
  } else if (error instanceof ConfluentSchemaRegistryError) {
    void reply.code(400);
    message = error.message;
  } else if (error instanceof ClientError) {
    void reply.code(error.statusCode);
    message = error.message;
  } else if (isKafkaJSError(error as KafkaJSError)) {
    void reply.code(400);
    message = error.message;
  } else if (statusCode) { // error instanceof FastifyError
    void reply.code(statusCode);
  } else {
    void reply.code(500);
    message = '¯\\_(ツ)_/¯ Oops! Something went wrong';
  }

  return {
    error: {
      ...error,
      message,
    },
  };
};
