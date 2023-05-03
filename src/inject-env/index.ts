import { RouteShorthandOptions } from 'fastify';
import log from '../log';
import { ProduceOptions, SubscribeOptions } from '../types';

const BETWEEN_ANGLE_BRACKETS_REGEX = /\<([^>]+)\>/g; // ex. "FOO<ENV_VAR>BAR<ENV_VAR2>BAZ" -> ["<ENV_VAR>", "<ENV_VAR2>"]

export const injectEnvVars: RouteShorthandOptions['preValidation'] = async (request, reply, done) => {
  if (BETWEEN_ANGLE_BRACKETS_REGEX.test(JSON.stringify(request.body))) {
    request.body = replaceByEnvVars(request.body);
  }
};

const replaceByEnvVars = (obj: any): SubscribeOptions | ProduceOptions => {
  const result: any = {};
  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'object') {
      result[key] = replaceByEnvVars(value);
    } else if (typeof value === 'string') {
      const replacedValue = value.replace(BETWEEN_ANGLE_BRACKETS_REGEX, (match, ..._args) => {
        const envVarName = match.slice(1, -1);
        return process.env[envVarName] || '';
      });
      result[key] = key === 'brokers' ? replacedValue.split(',') : replacedValue;
    } else {
      result[key] = value;
    }
  }
  return result;
};