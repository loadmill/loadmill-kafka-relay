import { thisRelayInstanceId } from './relay-instance-id';

export const toInstanceKey = (instanceId: string = thisRelayInstanceId): string =>
  `${instancesPrefixKey}:${instanceId}`;

export const instancesPrefixKey = 'kafka-relay:instances';
