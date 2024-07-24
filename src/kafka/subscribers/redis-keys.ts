import { toInstanceKey } from '../../multi-instance/redis-keys';

export const toSubscribersKey = (relayInstanceId?: string): string =>
  `${toInstanceKey(relayInstanceId)}:subscribers`;

export const toSubscriberKey = (subscriberId: string, relayInstanceId?: string): string =>
  `${toSubscribersKey(relayInstanceId)}:${subscriberId}`;

export const toMessagesKey = (subscriberId: string, relayInstanceId?: string): string =>
  `${toSubscriberKey(subscriberId, relayInstanceId)}:messages`;
