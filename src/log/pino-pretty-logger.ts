import pino from 'pino';

import { APP_NAME } from '../constants';

const isDevelopment = process.env.NODE_ENV === 'development';

const devLoggerConfig = {
  level: 'debug',
  options: {
    colorize: true,
    ignore: 'pid,hostname',
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
  },
  target: 'pino-pretty',
};

const fileLoggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  options: {},
  target: 'pino/file',
};

const stdoutTarget = isDevelopment ? devLoggerConfig : fileLoggerConfig;

const fileTarget = {
  level: isDevelopment ? 'debug' : process.env.LOG_LEVEL || 'info',
  options: {
    destination: `${APP_NAME}.log`,
  },
  target: 'pino/file',
};

const targets = [
  fileTarget,
  stdoutTarget,
];

const transport = pino.transport({
  targets,
});

const pinoLogger = pino({
  level: 'debug', // https://github.com/pinojs/pino/issues/1639#issuecomment-1418324692
}, transport);

export { pinoLogger };
