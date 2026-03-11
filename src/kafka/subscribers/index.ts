import { isMultiInstance } from '../../multi-instance/is-multi-instance';
import { ConsumedMessage, ConsumeQueryOptions } from '../../types';

import { RedisSubscribersManager } from './redis-subscribers-manager';
import { subscriptionsManager } from './subscribers-manager-factory';

export const addSubscriber = subscriptionsManager.add;
export const getSubscriber = subscriptionsManager.get;
export const removeSubscriber = subscriptionsManager.delete;
export const getActiveSubscribers = subscriptionsManager.getActiveSubscribers;
export const isSubscriberExists = subscriptionsManager.isSubscriberExists;

export const getMessages = (
  subscriberId: string,
  options?: ConsumeQueryOptions,
): ConsumedMessage[] | Promise<ConsumedMessage[]> => {
  return isMultiInstance() ?
    (subscriptionsManager as RedisSubscribersManager).getMessages(subscriberId, options) :
    subscriptionsManager.get(subscriberId).getMessages();
};

export const takeOverSubscribers = (subscriptionsManager as RedisSubscribersManager).takeOverSubscribers;
export const getLocalSubscribers = (subscriptionsManager as RedisSubscribersManager).getLocalSubscribers;
