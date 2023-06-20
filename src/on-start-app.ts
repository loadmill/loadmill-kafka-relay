import 'dotenv/config';

import { startCloseOldConnectionsInterval } from './kafka/connections';
import {
  handleKafkaCompressionEnvVars,
  handleKafkaRegistryEnvVars,
} from './kafka/schema-registry';

startCloseOldConnectionsInterval();

handleKafkaCompressionEnvVars();

handleKafkaRegistryEnvVars();
