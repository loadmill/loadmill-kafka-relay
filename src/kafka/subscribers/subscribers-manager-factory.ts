import { redisClient } from '../../redis/client';

import { RedisSubscribersManager } from './redis-subscribers-manager';
import { SubscribersManager } from './subscribers-manager';

class SubscriberManagerSingletonFactory {
  private static instance: SubscribersManager;

  static getInstance(): SubscribersManager {
    if (!this.instance) {
      this.instance = redisClient ?
        new RedisSubscribersManager(redisClient) :
        new SubscribersManager();
    }
    return this.instance;
  }
}

export const subscriptionsManager = SubscriberManagerSingletonFactory.getInstance();
