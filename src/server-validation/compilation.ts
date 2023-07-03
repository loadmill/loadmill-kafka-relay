import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import addFormats from 'ajv-formats';
import { FastifySchema, FastifySchemaCompiler } from 'fastify';

export const compile: FastifySchemaCompiler<FastifySchema> = ({ schema }) => {
  const ajv = new Ajv({ allErrors: true });
  ajvErrors(ajv);
  addFormats(ajv);
  return ajv.compile(schema);
};
