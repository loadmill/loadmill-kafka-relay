import { Consumer } from 'kafkajs';

import { Subscription } from '../../types';

export interface Subscriptions {
  add(id: string, consumer: Consumer, topic: string): Subscription;
  delete(id: string): void;
  get(id: string): Subscription;
}
