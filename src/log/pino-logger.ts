import fs from 'fs';

import pino, {
  Level,
  multistream,
  stdSerializers,
  StreamEntry,
  transport,
} from 'pino';

import { APP_NAME } from '../constants';

const getLogLevel = (): Level => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL as Level;
  }
  if (process.env.NODE_ENV === 'development') {
    return 'debug';
  }
  return 'info';
};

const streams: StreamEntry[] = [];
const addConsoleStream = () => {
  if (process.env.NODE_ENV === 'development') {
    const prettyTransport = transport({
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      },
      target: 'pino-pretty',
    });
    streams.push({ level: getLogLevel(), stream: prettyTransport });
  } else {
    streams.push({ level: getLogLevel(), stream: process.stdout });
  }
};
const addFileStream = () => {
  streams.push({
    level: getLogLevel(),
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
    serializers: {
      err: stdSerializers.err,
      error: stdSerializers.err,
    },
  },
  multistream(streams, { dedupe: true }),
);

export { pinoLogger };
