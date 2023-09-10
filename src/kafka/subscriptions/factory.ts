import { DefaultSubscriptions } from './default';
import { RedisSubscriptions } from './redis';
import { Subscriptions } from './types';

export class SubscriptionsSingletonFactory {
  private static instance: Subscriptions;

  static getInstance(): Subscriptions {
    if (!this.instance) {
      this.instance = process.env.REDIS_URL ?
        new RedisSubscriptions() :
        new DefaultSubscriptions();
    }
    return this.instance;
  }
}

export const subscriptionsManager = SubscriptionsSingletonFactory.getInstance();
