import { logCreator, logLevel, LoggerEntryContent } from 'kafkajs';

import log from '../../log';

export const kafkaLogCreator: logCreator = (_logLevel) => {
  return ({ log: value, level }) => {
    const msg = toLogMessage(value);

    switch (level) {
    case logLevel.ERROR:
      log.error(msg);
      break;
    case logLevel.WARN:
      log.warn(msg);
      break;
    case logLevel.INFO:
      log.info(msg);
      break;
    case logLevel.DEBUG:
      log.debug(msg);
      break;
    default:
      log.trace(msg);
      break;
    }
  };
};

const toLogMessage = (value: LoggerEntryContent) => {
  return `[KAFKA]: ${JSON.stringify(value)}`;
}
