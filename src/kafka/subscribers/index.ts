import { RedisSubscribersManager } from './redis-subscribers-manager';
import { subscriptionsManager } from './subscribers-manager-factory';

export const addSubscriber = subscriptionsManager.add;
export const getSubscriber = subscriptionsManager.get;
export const removeSubscriber = subscriptionsManager.delete;
export const getActiveSubscribers = subscriptionsManager.getActiveSubscribers;
export const isSubscriberExists = subscriptionsManager.isSubscriberExists;
export const getMessages = subscriptionsManager.getMessages;

export const takeOverSubscribers = (subscriptionsManager as RedisSubscribersManager).takeOverSubscribers;
export const getLocalSubscribers = (subscriptionsManager as RedisSubscribersManager).getLocalSubscribers;
