import { Consumer } from 'kafkajs';
import { createClient } from 'redis';

import log from '../../log';
import { Subscription } from '../../types';

import { Subscriptions } from './types';

export class RedisSubscriptions implements Subscriptions {
  private readonly subscriptions: Subscription[] = [];
  private readonly redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  constructor() {
    this.redisClient.on('error', (error) => {
      log.error(error);
    });
    this.redisClient.connect();
  }

  add = (id: string, consumer: Consumer, topic: string): Subscription => {
    const subscription = {
      consumer,
      id,
      messages: [],
      timeOfSubscription: Date.now(),
      topic,
    };

    this.addSubscriptionToRedis(id, topic, subscription);

    return subscription;
  };

  get = (id: string): Subscription => {
    return this.subscriptions.find((s) => s.id === id) as Subscription;
  };

  delete = (id: string): void => {
    const index = this.subscriptions.findIndex((s) => s.id === id);
    this.subscriptions.splice(index, 1);
  };

  addSubscriptionToRedis = (id: string, topic: string, subscription: Subscription): void => {
    // this.redisClient.lPush(id, JSON
  };
}
