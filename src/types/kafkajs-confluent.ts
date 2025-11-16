import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { KafkaJSError, Kafka as KafkaType } from '@confluentinc/kafka-javascript/types/kafkajs';

const Kafka = KafkaJS.Kafka;
const isKafkaJSError = KafkaJS.isKafkaJSError;

export { Kafka, isKafkaJSError };
export type { KafkaType, KafkaJSError };
