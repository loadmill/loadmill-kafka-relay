import { Logger } from '@confluentinc/kafka-javascript/types/kafkajs';
import pino from 'pino';

export type PinoLogger = pino.Logger;
export type RelayLogger = PinoLogger & Pick<Logger, 'setLogLevel' | 'namespace'>;
export type LogLevel = pino.Level;
