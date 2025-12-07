import { LogLevel, PinoLogger, RelayLogger } from './types';

export class KafkaRelayLogger {
  logger: RelayLogger;
  logLevel: number;

  constructor(pinoLogger: PinoLogger) {
    this.logger = pinoLogger as RelayLogger;
    this.logLevel = 3; // INFO level
  }

  get level(): string {
    return this.logger.level;
  }

  set level(value: string) {
    this.setLogLevel(value);
  }

  setLogLevel(level: string | number): void {
    if (typeof level === 'number') {
      const mapped = kafkaJsLogLevelToPino[level];
      if (!mapped) {
        throw new Error(`unknown level value${level}`);
      }
      this.logger.level = mapped;
    } else {
      this.logger.level = level;
    }
  }

  info(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('info', messageOrObj, extraOrMessage);
  }

  error(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('error', messageOrObj, extraOrMessage);
  }

  warn(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('warn', messageOrObj, extraOrMessage);
  }

  debug(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('debug', messageOrObj, extraOrMessage);
  }

  fatal(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('fatal', messageOrObj, extraOrMessage);
  }

  trace(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('trace', messageOrObj, extraOrMessage);
  }

  silent(messageOrObj: unknown, extraOrMessage?: unknown): void {
    this.log('trace', messageOrObj, extraOrMessage);
  }

  child(bindings: object): KafkaRelayLogger {
    const childLogger = this.logger.child(bindings);
    return new KafkaRelayLogger(childLogger as PinoLogger);
  }

  private log(level: LogLevel, messageOrObj: unknown, extraOrMessage?: unknown): void {
    if (typeof messageOrObj === 'string') {
      // Kafka style: (message, extra) -> convert to Pino style: (extra, message)
      if (extraOrMessage && typeof extraOrMessage === 'object') {
        this.logger[level](extraOrMessage, messageOrObj);
      } else {
        this.logger[level](messageOrObj);
      }
    } else if (typeof messageOrObj === 'object' && messageOrObj !== null) {
      // Pino style: (obj, message) -> pass through as-is
      if (extraOrMessage) {
        this.logger[level](messageOrObj, extraOrMessage as string);
      } else {
        this.logger[level](messageOrObj);
      }
    } else {
      // Fallback: log as a simple message (handles unknown types, primitives, etc.)
      this.logger[level](String(messageOrObj));
    }
  }

  namespace(): KafkaRelayLogger {
    return this;
  }
}

const kafkaJsLogLevelToPino: Record<number, string> = {
  0: 'silent', // NOTHING
  1: 'error',
  2: 'warn',
  3: 'info',
  4: 'debug',
};
