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

const validHeaderNameRegex = '^[0-9A-Za-z_^`|~!#$%&\'*+\-.]+$';

const headersEncode = {
  type: 'object',
  patternProperties: {
    [validHeaderNameRegex]: {
      type: 'object',
    },
  },
};

const encodeProduce = {
  additionalProperties: false,
  type: 'object',
  properties: {
    headers: headersEncode,
    value: encode,
  },
};

const conversions = {
  type: 'array',
  items: {
    additionalProperties: false,
    type: 'object',
    properties: {
      key: { type: 'string' },
      type: { type: 'string', enum: ['bytes', 'decimal'] },
    },
    required: ['key', 'type'],
  },
};

const message = {
  additionalProperties: false,
  type: 'object',
  properties: {
    key: { type: ['string'] },
    value: { type: ['string', 'object', 'number', 'boolean', 'null'] },
    headers: {
      type: 'object',
      patternProperties: {
        [validHeaderNameRegex]: { type: ['string', 'object', 'number', 'boolean', 'null'] },
      },
    },
  },
  required: ['value'],
};

export const produceValidationSchema: FastifySchema = {
  body: {
    additionalProperties: false,
    type: 'object',
    properties: {
      brokers,
      topic,
      message,
      conversions,
      encode: encodeProduce,
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
      timestamp: {
        type: 'number',
        description: 'Optional epoch timestamp',
        minimum: 1000000000000, // Minimum value for a valid epoch timestamp in milliseconds
      },
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
      headerFilter: { type: 'string', format: 'regex' },
      multiple: {
        type: 'string',
        format: 'int32',
        pattern: '^(?:[1-9]|[1-9][0-9]|100)$', // min 1, max 100
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
        multiple: 'Should be an integer between 1 and 100',
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
