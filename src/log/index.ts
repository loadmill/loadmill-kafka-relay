import pino from 'pino';

import { APP_NAME } from '../constants';

const baseTargetOptions = {
  ignore: 'pid,hostname',
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
};

const baseTarget = {
  level: process.env.LOG_LEVEL || 'info',
  options: baseTargetOptions,
  target: 'pino-pretty',
};

const stdoutTarget = {
  ...baseTarget,
  options: {
    ...baseTargetOptions,
    colorize: true,
  },
};

if (process.env.NODE_ENV === 'development') {
  stdoutTarget.level = 'debug';
}

const fileTarget = {
  ...baseTarget,
  options: {
    ...baseTargetOptions,
    colorize: false,
    destination: `${APP_NAME}.log`,
  },
};

const targets = [
  fileTarget,
  stdoutTarget,
];

const transport = pino.transport({
  targets,
});

const log = pino({
  level: 'debug', // https://github.com/pinojs/pino/issues/1639#issuecomment-1418324692
}, transport);

export default log;
