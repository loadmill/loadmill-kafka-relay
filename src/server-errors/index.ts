import { ConfluentSchemaRegistryError } from '@kafkajs/confluent-schema-registry/dist/errors';
import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { KafkaJSError } from 'kafkajs';

import { ClientError } from '../errors';

type ErrorType = ClientError | FastifyError | KafkaJSError | ConfluentSchemaRegistryError;

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

export const serverErrorHandler = async (
  error: ErrorType,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PresentableError> => {
  const { log } = request;
  log.error(error);
  let message = error.message || '¯\\_(ツ)_/¯ There was an error';
  const statusCode = (error as FastifyError).statusCode;

  if (error.name === 'ResponseError') {
    await reply.code((error as ResponseError).status);
    message = (error as ResponseError).message;
  } else if (error instanceof ConfluentSchemaRegistryError) {
    await reply.code(400);
    message = error.message;
  } else if (error instanceof ClientError) {
    await reply.code(error.statusCode);
    message = error.message;
  } else if (error instanceof KafkaJSError) {
    await reply.code(400);
    message = error.message;
  } else if (statusCode) { // error instanceof FastifyError
    await reply.code(statusCode);
  } else {
    await reply.code(500);
    message = '¯\\_(ツ)_/¯ Oops! Something went wrong';
  }

  return {
    error: {
      ...error,
      message,
    },
  };
};
