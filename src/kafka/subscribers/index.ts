import { RedisSubscribersManager } from './redis-subscribers-manager';
import { subscriptionsManager } from './subscribers-manager-factory';
import { releaseAllTopicLeadership } from './topic-consumers-manager';

export const addSubscriber = subscriptionsManager.add;
export const getSubscriber = subscriptionsManager.get;
export const removeSubscriber = subscriptionsManager.delete;
export const getActiveSubscribers = subscriptionsManager.getActiveSubscribers;
export const isSubscriberExists = subscriptionsManager.isSubscriberExists;
export const getMessages = subscriptionsManager.getMessages;

export const takeOverSubscribers = (subscriptionsManager as RedisSubscribersManager).takeOverSubscribers;
// Best-effort warmup on graceful shutdown handoff.
export const warmUpTopicsFromInstance = (subscriptionsManager as RedisSubscribersManager).warmUpTopicsFromInstance;
// Best-effort speedup: release topic leadership locks on graceful shutdown.
export { releaseAllTopicLeadership };
