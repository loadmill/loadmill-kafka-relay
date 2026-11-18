import { thisRelayInstanceId } from '../../multi-instance';
import { kafkaRelayPrefixKey } from '../../multi-instance/redis-keys';

import { toTopicStateRedisNamespace } from './topic-state-namespace';

export const toSubscriberKey = (
  subscriberId: string,
  relayInstanceId: string = thisRelayInstanceId,
): string =>
  `${kafkaRelayPrefixKey}:${relayInstanceId}:subscribers:${subscriberId}`;

export const toMessagesKey = (subscriberId: string): string =>
  `${kafkaRelayPrefixKey}:subscribers:${subscriberId}:messages`;

export const toTopicMessagesKey = (topic: string): string =>
  `${toTopicStateRedisNamespace(topic)}:messages`;

export const toTopicLeaderKey = (topic: string): string =>
  `${toTopicStateRedisNamespace(topic)}:leader`;

export const toTopicPartitionOffsetWatermarksKey = (topic: string): string =>
  `${toTopicStateRedisNamespace(topic)}:partition-offset-watermarks`;
