import pino from 'pino';

import { APP_NAME } from '../constants';

const baseTargetOptions = {
  ignore: 'pid,hostname',
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
};

const baseTarget = {
  target: 'pino-pretty',
  options: baseTargetOptions,
};

const stdoutTarget = {
  ...baseTarget,
  level: 'debug',
  options: {
    ...baseTargetOptions,
    colorize: true,
  },
};

const fileTarget = {
  ...baseTarget,
  level: 'info',
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

const log = pino({}, transport);

export default log;
