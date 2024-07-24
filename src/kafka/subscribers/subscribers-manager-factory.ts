import { isMultiInstance } from '../../multi-instance/is-multi-instance';

import { RedisSubscribersManager } from './redis-subscribers-manager';
import { SubscribersManager } from './subscribers-manager';

class SubscriberManagerSingletonFactory {
  private static instance: SubscribersManager;

  static getInstance(): SubscribersManager {
    if (!this.instance) {
      this.instance = isMultiInstance() ?
        new RedisSubscribersManager() :
        new SubscribersManager();
    }
    return this.instance;
  }
}

export const subscriptionsManager = SubscriberManagerSingletonFactory.getInstance();
