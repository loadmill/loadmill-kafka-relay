import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { FastifySchema, FastifySchemaCompiler } from 'fastify';

export const compile: FastifySchemaCompiler<FastifySchema> = ({ schema }) => {
  const ajv = new Ajv({});
  addFormats(ajv);
  return ajv.compile(schema);
};
