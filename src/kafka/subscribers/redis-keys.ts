import { kafkaRelayPrefixKey } from '../../multi-instance/redis-keys';
import { thisRelayInstanceId } from '../../multi-instance/relay-instance-id';

export const toSubscriberKey = (
  subscriberId: string,
  relayInstanceId: string = thisRelayInstanceId,
): string =>
  `${kafkaRelayPrefixKey}:${relayInstanceId}:subscribers:${subscriberId}`;

export const toMessagesKey = (subscriberId: string): string =>
  `${kafkaRelayPrefixKey}:subscribers:${subscriberId}:messages`;
