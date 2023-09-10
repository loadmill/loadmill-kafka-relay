import { Consumer } from 'kafkajs';

import log from '../../log';
import { Subscription } from '../../types';

import { MAX_OPEN_CONNECTION_TIME_MS, SUBSCRIPTION_TIMEOUT_INTERVAL_MS } from './constants';
import { Subscriptions } from './types';

export class DefaultSubscriptions implements Subscriptions {
  private subscriptions: Subscription[] = [];

  constructor() {
    this.startTimeoutSubscriptionInterval();
  }

  add = (id: string, consumer: Consumer, topic: string): Subscription => {
    const subscription = {
      consumer,
      id,
      messages: [],
      timeOfSubscription: Date.now(),
      topic,
    };
    this.subscriptions.push(subscription);
    return subscription;
  };

  get = (id: string): Subscription => {
    return this.subscriptions.find((s) => s.id === id) as Subscription;
  };

  delete = (id: string): void => {
    const index = this.subscriptions.findIndex((s) => s.id === id);
    this.subscriptions.splice(index, 1);
  };

  set = (subscriptions: Subscription[]): void => {
    this.subscriptions = subscriptions;
  };

  startTimeoutSubscriptionInterval = (): void => {
    setInterval(this.timeoutSubscription, SUBSCRIPTION_TIMEOUT_INTERVAL_MS);
  };

  timeoutSubscription = (): void => {
    const now = Date.now();
    const expiredSubscriptions = this.subscriptions.filter(({ timeOfSubscription }) => {
      return now - timeOfSubscription > MAX_OPEN_CONNECTION_TIME_MS;
    });
    const expiredSubscriptionIds = expiredSubscriptions.map(({ id }) => id);
    this.unsubscribe(expiredSubscriptionIds);
  };

  unsubscribe = (ids: string[]): void => {
    ids.forEach((id) => {
      log.info(`Unsubscribing ${id}`);
      const subscription = this.get(id);
      subscription.consumer.disconnect();
      this.delete(id);
    });
  };
}
