import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { KafkaJSError } from "kafkajs";

import { ClientError } from "../errors";

type ErrorType = ClientError | FastifyError | KafkaJSError;

export const serverErrorHandler = (error: ErrorType, request: FastifyRequest, reply: FastifyReply) => {
  const { log } = request;
  log.error(error);
  reply.type("application/json");
  let message = error.message || "¯\\_(ツ)_/¯ There was an error";

  if (error instanceof ClientError) {
    reply.code(error.statusCode);
    message = error.message;
  } else if (error instanceof KafkaJSError) {
    reply.code(400);
    message = error.message;
  } else if (!(error as FastifyError).statusCode) {
    reply.code(500);
    message = "¯\\_(ツ)_/¯ Oops! Something went wrong";
  }

  return {
    error: {
      ...error,
      message,
    },
  };
}