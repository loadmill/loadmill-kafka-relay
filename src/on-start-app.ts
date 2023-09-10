import 'dotenv/config';

import {
  handleKafkaCompressionEnvVars,
  handleKafkaRegistryEnvVars,
} from './kafka/schema-registry';

handleKafkaCompressionEnvVars();

handleKafkaRegistryEnvVars();
