import { ConsumedMessage } from '../../types';

import { RedisSubscriber } from './redis-subscriber';

export type SerializedRedisSubscriber = Pick<RedisSubscriber,
  'id' |
  'instanceId' |
  'kafkaConfig' |
  'requestedStartTimestamp' |
  'timeOfSubscription' |
  'topic'
  > & {
  messages: ConsumedMessage[];
};
