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

const convertions = {
  additionalProperties: false,
  type: 'array',
  items: {
    additionalProperties: false,
    type: 'object',
    properties: {
      key: { type: 'string' },
      type: { type: 'string', enum: ['decimal'] },
    },
    required: ['key', 'type'],
  },
};

export const produceValidationSchema: FastifySchema = {
  body: {
    additionalProperties: false,
    type: 'object',
    properties: {
      brokers,
      message: { type: ['string', 'object'] },
      topic,
      convertions,
      encode,
      sasl,
      ssl,
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
      text: {
        type: 'string',
        enum: ['true', 'false', 'TRUE', 'FALSE', 'True', 'False', '1', '0'],
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
        text: 'Should be a boolean (true/false)',
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
