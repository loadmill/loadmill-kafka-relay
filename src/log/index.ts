import { KafkaRelayLogger } from './kafka-pino-adapter';
import { pinoLogger } from './pino-logger';

const kafkaRelayLogger = new KafkaRelayLogger(pinoLogger);

export default kafkaRelayLogger;
