import { isMultiInstance } from '../../multi-instance/is-multi-instance';
import { ConsumedMessage } from '../../types';

import { RedisSubscribersManager } from './redis-subscribers-manager';
import { subscriptionsManager } from './subscribers-manager-factory';

export const addSubscriber = subscriptionsManager.add;
export const getSubscriber = subscriptionsManager.get;
export const removeSubscriber = subscriptionsManager.delete;
export const getActiveSubscribers = subscriptionsManager.getActiveSubscribers;
export const isSubscriberExists = subscriptionsManager.isSubscriberExists;

export const getMessages = (
  subscriberId: string,
  limit: number,
  offset: number,
): ConsumedMessage[] | Promise<ConsumedMessage[]> => {
  if (isMultiInstance()) {
    return (subscriptionsManager as unknown as RedisSubscribersManager).getMessages(subscriberId, limit, offset);
  }
  return subscriptionsManager.get(subscriberId).getMessages(limit, offset);
};

export const takeOverSubscribers = (subscriptionsManager as unknown as RedisSubscribersManager).takeOverSubscribers;
export const getLocalSubscribers = (subscriptionsManager as unknown as RedisSubscribersManager).getLocalSubscribers;
