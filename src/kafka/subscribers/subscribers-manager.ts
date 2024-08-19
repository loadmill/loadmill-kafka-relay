
import log from '../../log';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import {
  MAX_SUBSCRIBER_EXPIRY_TIME_MS,
  SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS,
} from './constants';
import { Subscriber, Subscribers } from './subscriber';

export class SubscribersManager {
  protected readonly subscribers: Subscribers = {};

  constructor() {
    this.startDeletingExpiredSubscribers();
  }

  add = (
    { brokers, topic }: SubscribeParams,
    { sasl, ssl }: SubscribeOptions,
  ): Subscriber | Promise<Subscriber> => {
    const subscriber = new Subscriber({ brokers, topic }, { sasl, ssl });
    this.subscribers[subscriber.id] = subscriber;
    return subscriber;
  };

  get = (id: string): Subscriber => {
    return this.subscribers[id];
  };

  delete = async (id: string): Promise<string | undefined> => {
    const subscriber = this.subscribers[id];
    if (subscriber) {
      const { consumer } = subscriber;
      await consumer.disconnect();
      delete this.subscribers[id];
      return id;
    }
  };

  getActiveSubscribers = (): Subscribers | Promise<Subscribers> => {
    return this.subscribers;
  };

  isSubscriberExists = (id: string): boolean | Promise<boolean> =>{
    return !!this.subscribers[id];
  };

  getMessages = (subscriberId: string): ConsumedMessage[] | Promise<ConsumedMessage[]> => {
    const subscriber = this.get(subscriberId);
    if (subscriber) {
      return subscriber.getMessages();
    }
    return [];
  };

  protected startDeletingExpiredSubscribers = (): void => {
    setInterval(() => this.deleteExpiredSubscribers(), SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS);
  };

  protected deleteExpiredSubscribers = async (): Promise<void> => {
    await Promise.all(Object.entries(this.subscribers)
      .map(async ([id, subscriber]) => {
        const { timeOfSubscription, consumer } = subscriber;
        if (this.shouldUnsubscribe(timeOfSubscription)) {
          log.info({ id, timeOfSubscription, topic: subscriber.topic }, 'Unsubscribing expired subscriber');
          await consumer.disconnect();
          delete this.subscribers[id];
        }
      }));
  };

  protected shouldUnsubscribe(timeOfSubscription: number): boolean {
    return Date.now() - timeOfSubscription > MAX_SUBSCRIBER_EXPIRY_TIME_MS;
  }
}
