import { FastifySchema } from 'fastify';

const brokers = {
  type: 'array',
  items: { type: 'string', format: 'uri' },
};

const topic = { type: 'string' };

const sasl = {
  additionalProperties: false,
  type: 'object',
  properties: {
    mechanism: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['mechanism', 'username', 'password'],
};

const ssl = { type: 'boolean' };

const encode = {
  additionalProperties: false,
  type: 'object',
  properties: {
    subject: { type: 'string' },
    version: { type: 'number' },
  },
  required: ['subject'],
};

export const produceValidationSchema: FastifySchema = {
  body: {
    additionalProperties: false,
    type: 'object',
    properties: {
      brokers,
      topic,
      message: { type: ['string', 'object'] },
      sasl,
      ssl,
      encode,
    },
    required: ['brokers', 'topic', 'message'],
  },
};

export const subscribeValidationSchema: FastifySchema = {
  body: {
    additionalProperties: false,
    type: 'object',
    properties: {
      brokers,
      topic,
      sasl,
      ssl,
    },
    required: ['brokers', 'topic'],
  },
};

export const consumeValidationSchema: FastifySchema = {
  params: {
    additionalProperties: false,
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
  querystring: {
    additionalProperties: false,
    type: 'object',
    properties: {
      filter: { type: 'string', format: 'regex' },
      multiple: {
        type: 'string',
        format: 'int32',
        pattern: '^(?:[1-9]|10)$', // min 1, max 10
      },
      timeout: {
        type: 'string',
        format: 'int32',
        pattern: '^(?:[5-9]|1[0-9]|2[0-5])$', // min 5, max 25
      },
    },
    errorMessage: {
      properties: {
        multiple: 'Should be an integer between 1 and 10',
        timeout: 'Should be an integer between 5 and 25',
      },
    },
  },
};

export const registryValidationSchema: FastifySchema = {
  body: {
    additionalProperties: false,
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      auth: {
        additionalProperties: false,
        type: 'object',
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
        required: ['username', 'password'],
      },
      encode,
    },
    required: ['url'],
  },
};

export const encodeValidationSchema: FastifySchema = {
  body: {
    ...encode,
  },
};
