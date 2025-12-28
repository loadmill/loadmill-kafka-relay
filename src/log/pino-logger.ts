import fs from 'fs';

import pino from 'pino';

import { APP_NAME } from '../constants';

const streams: pino.StreamEntry[] = [];

const addConsoleStream = () => {
  if (process.env.NODE_ENV === 'development') {
    const prettyTransport = pino.transport({
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      },
      target: 'pino-pretty',
    });
    streams.push({ level: 'debug', stream: prettyTransport });
  } else {
    streams.push({ level: 'info', stream: process.stdout });
  }
};
const addFileStream = () => {
  streams.push({
    level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
    stream: fs.createWriteStream(`${APP_NAME}.log`, { flags: 'a' }),
  });
};

addConsoleStream();
addFileStream();

const pinoLogger = pino(
  {
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    level: 'debug', // Must set base level to debug https://github.com/pinojs/pino/issues/1639#issuecomment-1418324692
  },
  pino.multistream(streams, { dedupe: true }),
);

export { pinoLogger };
