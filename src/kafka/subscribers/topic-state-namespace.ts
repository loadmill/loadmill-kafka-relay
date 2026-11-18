import { createHash } from 'crypto';

import { kafkaRelayPrefixKey } from '../../multi-instance/redis-keys';

export const TOPIC_SHARED_STATE_VERSION = 'v2';

export const toTopicStateRedisNamespace = (topic: string): string =>
  `${kafkaRelayPrefixKey}:topics:${TOPIC_SHARED_STATE_VERSION}:${encodeURIComponent(topic)}`;

export const toTopicStateConsumerGroupId = (topic: string): string => {
  const digest = createHash('sha1').update(topic).digest('hex').slice(0, 16);
  return `kafka-relay-topic-${TOPIC_SHARED_STATE_VERSION}-${digest}`;
};
