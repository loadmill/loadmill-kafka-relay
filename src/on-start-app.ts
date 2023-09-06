import 'dotenv/config';

import {
  handleKafkaCompressionEnvVars,
  handleKafkaRegistryEnvVars,
} from './kafka/schema-registry';
import { startTimeoutSubscriptionInterval } from './kafka/subscriptions';

startTimeoutSubscriptionInterval();

handleKafkaCompressionEnvVars();

handleKafkaRegistryEnvVars();
