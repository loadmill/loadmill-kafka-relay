import 'dotenv/config';

import { handleKafkaRegistryEnvVars } from './kafka/schema-registry';
import log from './log';
import {
  initializeMultiInstance,
  isMultiInstance,
} from './multi-instance';

log.info('Starting Kafka Relay App');

if (isMultiInstance()) {
  log.info('This Relay supports multi-instance mode');
  void initializeMultiInstance();
} else {
  log.info('This Relay runs in single instance mode');
}

void handleKafkaRegistryEnvVars();
