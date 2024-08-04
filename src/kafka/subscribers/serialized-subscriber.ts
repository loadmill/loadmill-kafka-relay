import { ConsumedMessage } from '../../types';

import { RedisSubscriber } from './redis-subscriber';

export type SerializedRedisSubscriber = Pick<RedisSubscriber,
  'id' |
  'kafkaConfig' |
  'timeOfSubscription' |
  'topic'
  > & {
  messages: ConsumedMessage[];
};
