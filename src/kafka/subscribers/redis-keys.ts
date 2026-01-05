import { thisRelayInstanceId } from '../../multi-instance';
import { kafkaRelayPrefixKey } from '../../multi-instance/redis-keys';

const encodeKeyPart = (value: string): string => encodeURIComponent(value);

export const toSubscriberKey = (
  subscriberId: string,
  relayInstanceId: string = thisRelayInstanceId,
): string =>
  `${kafkaRelayPrefixKey}:${relayInstanceId}:subscribers:${subscriberId}`;

export const toMessagesKey = (subscriberId: string): string =>
  `${kafkaRelayPrefixKey}:subscribers:${subscriberId}:messages`;

export const toTopicMessagesKey = (topic: string): string =>
  `${kafkaRelayPrefixKey}:topics:${encodeKeyPart(topic)}:messages`;

export const toTopicLeaderKey = (topic: string): string =>
  `${kafkaRelayPrefixKey}:topics:${encodeKeyPart(topic)}:leader`;
