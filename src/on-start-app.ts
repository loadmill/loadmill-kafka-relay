import 'dotenv/config';

import { initCrashLog } from './diagnostics/crash-log';
import { initExitHandlers } from './diagnostics/exit-log';
import { initPeriodicDiagnosticsLogger } from './diagnostics/periodic-diagnostics';
import { handleKafkaRegistryEnvVars } from './kafka/schema-registry';
import log from './log';
import {
  initializeMultiInstance,
  isMultiInstance,
} from './multi-instance';

log.info('Starting Kafka Relay App');

initCrashLog();
initExitHandlers();
initPeriodicDiagnosticsLogger();

if (isMultiInstance()) {
  log.info('This Relay supports multi-instance mode');
  void initializeMultiInstance();
} else {
  log.info('This Relay runs in single instance mode');
}

void handleKafkaRegistryEnvVars();
