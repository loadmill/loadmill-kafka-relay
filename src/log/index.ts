import { KafkaRelayLogger } from './kafka-pino-adapter';
import { pinoLogger } from './pino-pretty-logger';

const kafkaRelayLogger = new KafkaRelayLogger(pinoLogger);

export default kafkaRelayLogger;
