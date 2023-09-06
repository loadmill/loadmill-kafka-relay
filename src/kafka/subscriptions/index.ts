import { Consumer } from 'kafkajs';

import log from '../../log';
import { Subscription, Subscriptions } from '../../types';

const subscriptions: Subscriptions = [];

const MAX_OPEN_CONNECTION_TIME_MS = 10 * 1000 * 60; // 10 minutes
const SUBSCRIPTION_TIMEOUT_INTERVAL_MS = 1000 * 60; // 60 seconds

const timeoutSubscription = () => {
  const now = Date.now();
  Object.keys(subscriptions).forEach((id: string) => {
    const subscription = subscriptions.find((s) => s.id === id);
    if (!subscription) {
      return;
    }
    const { timeOfSubscription, consumer } = subscription;
    if (now - timeOfSubscription > MAX_OPEN_CONNECTION_TIME_MS) {
      log.info(`Unsubscribing ${id}`);
      consumer.disconnect();
      deleteSubscription(id);
    }
  });
};

export const startTimeoutSubscriptionInterval = (): void => {
  setInterval(timeoutSubscription, SUBSCRIPTION_TIMEOUT_INTERVAL_MS);
};

export const addSubscription = (id: string, consumer: Consumer, topic: string): Subscription => {
  const subscription = {
    consumer,
    id,
    messages: [],
    timeOfSubscription: Date.now(),
    topic,
  };
  subscriptions.push(subscription);
  return subscription;
};

export const getSubscription = (id: string): Subscription =>
  subscriptions.find((s) => s.id === id) as Subscription;

export const deleteSubscription = (id: string): void => {
  subscriptions.splice(subscriptions.findIndex((s) => s.id === id), 1);
};
