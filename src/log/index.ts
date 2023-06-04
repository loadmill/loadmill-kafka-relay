import { createLogger, format, transports } from 'winston';
import { APP_NAME } from '../constants';

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
  if (typeof message === 'object') {
    message = JSON.stringify(message, null, 2);
  }
  return `${timestamp} | ${level} | ${message}`;
});

const timestampFormat = timestamp({
  format: 'DD-MM-YYYY HH:mm:ss:SSS'
});

const log = createLogger({
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        timestampFormat,
        logFormat,
      ),
      level: 'debug',
    }),
    new transports.File({
      filename: `${APP_NAME}.log`,
      format: combine(
        timestampFormat,
        logFormat,
      ),
      level: 'info',
    })
  ]
});

export default log;