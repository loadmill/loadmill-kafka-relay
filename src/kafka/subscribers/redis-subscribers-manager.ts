
import log from '../../log';
import { thisRelayInstanceId } from '../../multi-instance';
import { RedisClient } from '../../redis/client';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';

import {
  MAX_SUBSCRIBER_TTL_SECONDS,
  SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS,
} from './constants';
import { toMessagesKey, toSubscriberKey } from './redis-keys';
import { RedisSubscriber, RedisSubscribers } from './redis-subscriber';
import { SerializedRedisSubscriber } from './serialized-subscriber';
import { SubscribersManager } from './subscribers-manager';

/**
 * Manages Kafka subscribers using Redis as a data store.
 * Supports multiple instances of this Kafka Relay App.
 */
export class RedisSubscribersManager extends SubscribersManager {
  protected readonly subscribers: RedisSubscribers = {};

  constructor(private readonly redisClient: RedisClient) {
    super();
    log.info('Initializing RedisSubscriberManager');
    this.startDeletingExpiredSubscribers();
  }

  add = async (
    { brokers, topic }: SubscribeParams,
    { sasl, ssl }: SubscribeOptions,
  ): Promise<RedisSubscriber> => {
    const subscriber = new RedisSubscriber({ brokers, topic }, { sasl, ssl });

    await this.addSubscriberToRedis(subscriber);

    return subscriber;
  };

  get = (id: string): RedisSubscriber => {
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
    await this.deleteSubscriberFromRedis(id);
  };

  getActiveSubscribers = (): RedisSubscribers => {
    return this.subscribers;
  };

  takeOverSubscribers = async (fromInstanceId: string): Promise<void> => {
    log.info({ fromInstanceId, thisRelayInstanceId }, 'Taking over subscribers');
    const subscriberIds = await this.getAllSubscribersIdsFromRedis(fromInstanceId);
    log.info({ subscriberIds }, 'Subscribers to take over');
    await Promise.all(subscriberIds.map(async (id) => {
      const subscriber = await this.recreateSubscriberFromRedis(id, fromInstanceId);
      if (subscriber) {
        await this.addSubscriberToRedis(subscriber);
        const timestamp = await this.inferTimestamp(subscriber);
        await subscriber.subscribe(timestamp);
      }
      await this.deleteSubscriberFromRedis(id, fromInstanceId);
    }));
  };

  private addSubscriberToRedis = async (subscriber: RedisSubscriber) => {
    const { id, kafkaConfig, timeOfSubscription, topic } = subscriber;
    log.debug({ id, topic }, 'Adding subscriber to Redis');
    this.subscribers[id] = subscriber;
    const serializedSubscriber = JSON.stringify({
      id,
      kafkaConfig,
      timeOfSubscription,
      topic,
    });
    await this.redisClient.set(toSubscriberKey(id), serializedSubscriber, { EX: MAX_SUBSCRIBER_TTL_SECONDS });
  };

  private getAllSubscribersIdsFromRedis = async (relayInstanceId: string): Promise<string[]> => {
    const keys = await this.redisClient.keys(toSubscriberKey('*', relayInstanceId));
    const subscriberIds = keys.map(key => {
      const match = key.match(/subscribers:([^:]+)/);
      return match ? match[1] : null;
    }).filter(id => id !== null);
    return Array.from(new Set(subscriberIds)) as string[];
  };

  private recreateSubscriberFromRedis = async (
    subscriberId: string,
    relayInstanceId: string,
  ): Promise<RedisSubscriber | undefined> => {
    log.debug({ subscriberId }, 'Getting subscriber from Redis');
    const serializedSubscriber = await this.redisClient.get(toSubscriberKey(subscriberId, relayInstanceId));
    if (serializedSubscriber) {
      log.debug({ subscriberId }, 'Recreating subscriber from Redis');
      const { timeOfSubscription, topic, kafkaConfig } = JSON.parse(serializedSubscriber) as SerializedRedisSubscriber;
      const { brokers, sasl, ssl } = kafkaConfig;
      const subscriber = new RedisSubscriber({ brokers, topic }, { sasl, ssl }, { id: subscriberId, timeOfSubscription });

      const serializedMessages = await this.redisClient.lRange(toMessagesKey(subscriberId, relayInstanceId), 0, -1);
      if (serializedMessages.length > 0) {
        log.debug({ serializedMessages }, 'Setting messages to subscriber');
        const messages = serializedMessages.map((message: string) => JSON.parse(message));
        await subscriber.setMessages(messages);
      }
      return subscriber;
    }
  };

  /**
   * If taking over subscribers from another instance,
   * infer the timestamp from the latest message.
   */
  private inferTimestamp = async (subscriber: RedisSubscriber): Promise<number | undefined> => {
    let timestamp;
    const messages = await subscriber.getMessages();
    if (messages.length > 0) {
      const latestMessage = this.getLatestMessageByTimestamp(messages);
      timestamp = Number(latestMessage.timestamp) + 1; // Add 1 to avoid duplicate messages
    }
    return timestamp;
  };

  private getLatestMessageByTimestamp = (messages: ConsumedMessage[]): ConsumedMessage => {
    return messages.reduce((latest, current) => {
      return current.timestamp > latest.timestamp ? current : latest;
    });
  };

  private deleteSubscriberFromRedis = async (
    subscriberId: string,
    relayInstanceId: string = thisRelayInstanceId,
  ): Promise<void> => {
    log.debug({ relayInstanceId, subscriberId }, 'Deleting subscriber and its messages from Redis');
    await this.redisClient.multi()
      .del(toSubscriberKey(subscriberId, relayInstanceId))
      .del(toMessagesKey(subscriberId, relayInstanceId))
      .exec();
  };

  protected startDeletingExpiredSubscribers = (): void => {
    setInterval(this.deleteExpiredSubscribers, SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS);
  };

  protected deleteExpiredSubscribers = async (): Promise<void> => {
    const activeSubscribersIds = await this.getAllSubscribersIdsFromRedis(thisRelayInstanceId);
    if (activeSubscribersIds.length === 0) {
      return;
    }
    await Promise.all(Object.entries(this.subscribers).map(async ([id, subscriber]) => {
      const { timeOfSubscription, consumer } = subscriber;
      if (!activeSubscribersIds.includes(id)) {
        log.info({ id, timeOfSubscription, topic: subscriber.topic }, 'Unsubscribing expired subscriber');
        await consumer.disconnect();
        delete this.subscribers[id];
      }
    }));
  };
}
