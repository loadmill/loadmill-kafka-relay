import { isMultiInstance } from '../../multi-instance/is-multi-instance';

import { SubscribersManager } from './subscribers-manager';

class SubscriberManagerSingletonFactory {
  private static instance: SubscribersManager;

  static getInstance(): SubscribersManager {
    if (!this.instance) {
      if (isMultiInstance()) {
        const { RedisSubscribersManager } = require('./redis-subscribers-manager') as typeof import('./redis-subscribers-manager');
        this.instance = new RedisSubscribersManager();
      } else {
        this.instance = new SubscribersManager();
      }
    }
    return this.instance;
  }
}

export const subscriptionsManager = SubscriberManagerSingletonFactory.getInstance();
