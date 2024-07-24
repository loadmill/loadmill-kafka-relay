import { thisRelayInstanceId } from '../../multi-instance';
import { kafkaRelayPrefixKey } from '../../multi-instance/redis-keys';

export const toSubscriberKey = (
  subscriberId: string,
  relayInstanceId: string = thisRelayInstanceId,
): string =>
  `${kafkaRelayPrefixKey}:${relayInstanceId}:subscribers:${subscriberId}`;

export const toMessagesKey = (subscriberId: string): string =>
  `${kafkaRelayPrefixKey}:subscribers:${subscriberId}:messages`;
