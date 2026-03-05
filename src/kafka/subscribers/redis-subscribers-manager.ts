import log from '../../log';
import { thisRelayInstanceId } from '../../multi-instance';
import {
  getRedisClient,
  getRedisSubscriberClient,
} from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import {
  ConsumedMessage,
  SubscribeOptions,
  SubscribeParams,
} from '../../types';

import {
  MAX_SUBSCRIBER_TTL_SECONDS,
  SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS,
} from './constants';
import { getMessagesFromRedis } from './messages';
import { DELETE_SUBSCRIBER_CHANNEL } from './redis-channels';
import { toSubscriberKey } from './redis-keys';
import { RedisSubscriber, RedisSubscribers } from './redis-subscriber';
import { SerializedRedisSubscriber } from './serialized-subscriber';
import { SubscribersManager } from './subscribers-manager';
import { ensureTopicConsumerRunning } from './topic-consumers-manager';

/**
 * Manages Kafka subscribers using Redis as a data store.
 * Supports multiple instances of this Kafka Relay App.
 */
export class RedisSubscribersManager extends SubscribersManager {
  protected readonly subscribers: RedisSubscribers = {};
  private readonly redisClient: RedisClient = getRedisClient();
  private readonly redisSubscriberClient: RedisClient = getRedisSubscriberClient();

  constructor() {
    super();
    this.startDeletingExpiredSubscribers();
    void this.subscribeToDeleteSubscriber();
  }

  protected startDeletingExpiredSubscribers = (): void => {
    setInterval(this.deleteExpiredSubscribers, SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS);
  };

  protected deleteExpiredSubscribers = async (): Promise<void> => {
    const activeSubscribersIds = await this.getAllSubscribersIdsFromRedis(thisRelayInstanceId);
    if (activeSubscribersIds.length === 0) {
      return;
    }
    await Promise.all(Object.entries(this.subscribers).map(async ([id, subscriber]) => {
      if (!activeSubscribersIds.includes(id)) {
        const { timeOfSubscription } = subscriber;
        log.info({ id, timeOfSubscription, topic: subscriber.topic }, 'Unsubscribing expired subscriber');
        await this.deleteInMemorySubscriber(id);
      }
    }));
  };

  private getAllSubscribersIdsFromRedis = async (relayInstanceId: string): Promise<string[]> => {
    const keys = await this.getAllSubscribersKeysFromRedis(relayInstanceId);
    return this.extractSubscriberIdsFromKeys(keys);
  };

  private getAllSubscribersKeysFromRedis = async (relayInstanceId: string): Promise<string[]> => {
    return await this.redisClient.keys(toSubscriberKey('*', relayInstanceId));
  };

  private extractSubscriberIdsFromKeys = (keys: string[]) => {
    const subscriberIds = keys.map(key => {
      const match = key.match(/subscribers:([^:]+)/);
      return match ? match[1] : null;
    }).filter(id => id !== null);
    return Array.from(new Set(subscriberIds)) as string[];
  };

  private async deleteInMemorySubscriber(id: string) {
    const subscriber = this.subscribers[id];
    if (subscriber) {
      const { consumer } = subscriber;
      try {
        if (consumer) {
          await consumer.disconnect();
        }
      } catch (error) {
        log.debug({ error, id }, 'Ignoring consumer disconnect error');
      }
      delete this.subscribers[id];
    }
  }

  private subscribeToDeleteSubscriber = async () => {
    await this.redisSubscriberClient.subscribe(DELETE_SUBSCRIBER_CHANNEL, async (subscriberId) => {
      if (this.isLocalSubscriberExists(subscriberId)) {
        log.info({ subscriberId }, 'Deleting local subscriber');
        await this.deleteSubscriber(subscriberId);
      }
    });
  };

  private isLocalSubscriberExists = (id: string): boolean => {
    return !!this.subscribers[id];
  };

  private async deleteSubscriber(id: string): Promise<void> {
    await this.deleteInMemorySubscriber(id);
    await this.deleteSubscriberFromRedis(id);
  }

  private deleteSubscriberFromRedis = async (
    subscriberId: string,
    relayInstanceId: string = thisRelayInstanceId,
  ): Promise<void> => {
    log.debug({ relayInstanceId, subscriberId }, 'Deleting subscriber from Redis');
    await this.redisClient.multi()
      .del(toSubscriberKey(subscriberId, relayInstanceId))
      .exec();
  };

  add = async (
    { brokers, topic }: SubscribeParams,
    { connectionTimeout, sasl, ssl, timestamp }: SubscribeOptions,
  ): Promise<RedisSubscriber> => {
    const subscriber = new RedisSubscriber(
      { brokers, topic },
      { connectionTimeout, sasl, ssl },
      { requestedStartTimestamp: timestamp ?? get1MinuteAgoTimestamp() },
    );

    await this.addSubscriberToRedis(subscriber);

    return subscriber;
  };

  private addSubscriberToRedis = async (subscriber: RedisSubscriber) => {
    const { id, instanceId, kafkaConfig, requestedStartTimestamp, timeOfSubscription, topic } = subscriber;
    log.debug({ id, topic }, 'Adding subscriber to Redis');
    this.subscribers[id] = subscriber;
    const serializedSubscriber = JSON.stringify({
      id,
      instanceId,
      kafkaConfig,
      requestedStartTimestamp,
      timeOfSubscription,
      topic,
    });
    await this.redisClient.set(toSubscriberKey(id), serializedSubscriber, { EX: MAX_SUBSCRIBER_TTL_SECONDS });
  };

  get = (id: string): RedisSubscriber => {
    return this.subscribers[id];
  };

  delete = async (id: string): Promise<string | undefined> => {
    if (this.isLocalSubscriberExists(id)) {
      await this.deleteSubscriber(id);
    } else {
      await this.publishDeleteSubscriberEvent(id);
    }
    return id;
  };

  private publishDeleteSubscriberEvent = async (subscriberId: string): Promise<void> => {
    await this.redisClient.publish(DELETE_SUBSCRIBER_CHANNEL, subscriberId);
  };

  isSubscriberExists = async (id: string): Promise<boolean> => {
    return (
      this.isLocalSubscriberExists(id) ||
      await this.isRedisSubscriberExists(id)
    );
  };

  private isRedisSubscriberExists = async (id: string): Promise<boolean> => {
    const allActiveSubscribers = await this.getAllSubscribersIdsFromRedis('*');
    return allActiveSubscribers.includes(id);
  };

  getMessages = async (subscriberId: string): Promise<ConsumedMessage[]> => {
    const localSubscriber = this.subscribers[subscriberId];
    if (localSubscriber) {
      await ensureTopicConsumerRunning(
        { brokers: localSubscriber.kafkaConfig.brokers, topic: localSubscriber.topic },
        {
          connectionTimeout: localSubscriber.kafkaConfig.connectionTimeout,
          sasl: localSubscriber.kafkaConfig.sasl,
          ssl: localSubscriber.kafkaConfig.ssl,
        },
        localSubscriber.requestedStartTimestamp,
      );
      const allMessages = await getMessagesFromRedis(localSubscriber.topic);
      return allMessages.filter(
        m => Number(m.timestamp) >= localSubscriber.requestedStartTimestamp,
      );
    }

    const redisSubscriber = await this.getSubscriberFromRedis(subscriberId);
    if (!redisSubscriber) {
      return [];
    }

    const { kafkaConfig, topic, requestedStartTimestamp } = redisSubscriber;
    const { brokers, connectionTimeout, sasl, ssl } = kafkaConfig;
    await ensureTopicConsumerRunning(
      { brokers, topic },
      { connectionTimeout, sasl, ssl },
      requestedStartTimestamp,
    );

    const subscriber = await this.recreateSubscriberFromRedis(subscriberId, redisSubscriber.instanceId, true);
    if (!subscriber) {
      return [];
    }

    const allMessages = await getMessagesFromRedis(topic);
    return allMessages.filter(
      m => Number(m.timestamp) >= subscriber.requestedStartTimestamp,
    );
  };

  private getSubscriberFromRedis = async (subscriberId: string): Promise<SerializedRedisSubscriber | undefined> => {
    const keys = await this.redisClient.keys(toSubscriberKey(subscriberId, '*'));
    if (keys.length === 0) {
      return;
    }
    const instanceId = keys[0].split(':')[1];
    const serialized = await this.redisClient.get(toSubscriberKey(subscriberId, instanceId));
    if (!serialized) {
      return;
    }
    return JSON.parse(serialized) as SerializedRedisSubscriber;
  };

  getLocalSubscribers = (): RedisSubscribers => {
    return this.subscribers;
  };

  getActiveSubscribers = async (): Promise<RedisSubscribers> => {
    const localSubscribers = this.subscribers;
    const nonLocalSubscriberIds = await this.getNonLocalSubscriberIds(localSubscribers);
    const redisSubscribers = await this.recreateSubscribersFromRedis(nonLocalSubscriberIds);
    return { ...localSubscribers, ...redisSubscribers };
  };

  private getNonLocalSubscriberIds = async (localSubscribers: RedisSubscribers): Promise<string[]> => {
    const localSubscriberIds = Object.keys(localSubscribers);
    const allRedisSubscribersIds = await this.getAllSubscribersIdsFromRedis('*');
    return allRedisSubscribersIds.filter(id => !localSubscriberIds.includes(id));
  };

  private recreateSubscribersFromRedis = async (nonLocalSubscriberIds: string[]): Promise<RedisSubscribers> => {
    const subscribersInstancesMap = await this.getSubscribersInstancesMap();
    const redisSubscribersArr = await Promise.all(
      nonLocalSubscriberIds.map(async (id) => {
        const instanceId = subscribersInstancesMap[id];
        return await this.recreateSubscriberFromRedis(id, instanceId, true);
      }),
    );
    const filteredRedisSubscribersArr = redisSubscribersArr.filter(subscriber => subscriber !== undefined) as RedisSubscriber[];
    return filteredRedisSubscribersArr.reduce((acc, subscriber) => {
      acc[subscriber.id] = subscriber;
      return acc;
    }, {} as RedisSubscribers);
  };

  private getSubscribersInstancesMap = async (): Promise<{ [subscriberId: string]: instanceId }> => {
    const redisSubscriberKeys = await this.getAllSubscribersKeysFromRedis('*');
    const subscribersInstancesMap = redisSubscriberKeys.reduce((acc, key) => {
      const subscriberId = key.split(':')[3];
      const instanceId = key.split(':')[1];
      acc[subscriberId] = instanceId;
      return acc;
    }, {} as { [subscriberId: string]: string });
    return subscribersInstancesMap;
  };

  private recreateSubscriberFromRedis = async (
    subscriberId: string,
    relayInstanceId: string,
    debug?: true,
  ): Promise<RedisSubscriber | undefined> => {
    log.debug({ subscriberId }, 'Getting subscriber from Redis');
    const serializedSubscriber = await this.redisClient.get(toSubscriberKey(subscriberId, relayInstanceId));
    if (serializedSubscriber) {
      log.debug({ subscriberId }, 'Recreating subscriber from Redis');
      const {
        instanceId,
        kafkaConfig,
        requestedStartTimestamp,
        timeOfSubscription,
        topic,
      } = JSON.parse(serializedSubscriber) as SerializedRedisSubscriber;
      const { brokers, connectionTimeout, sasl, ssl } = kafkaConfig;
      const subscriber = new RedisSubscriber(
        { brokers, topic },
        { connectionTimeout, sasl, ssl },
        {
          debugParams: debug && { instanceId },
          requestedStartTimestamp,
          takeOverParams: { id: subscriberId, timeOfSubscription },
        },
      );
      return subscriber;
    }
  };

  takeOverSubscribers = async (fromInstanceId: string): Promise<void> => {
    log.info({ fromInstanceId, thisRelayInstanceId }, 'Taking over subscribers');
    const subscriberIds = await this.getAllSubscribersIdsFromRedis(fromInstanceId);
    log.info({ subscriberIds }, 'Subscribers to take over');
    await Promise.all(subscriberIds.map(async (id) => {
      const subscriber = await this.recreateSubscriberFromRedis(id, fromInstanceId);
      if (subscriber) {
        await this.addSubscriberToRedis(subscriber);
        await subscriber.subscribe();
      }
      await this.deleteSubscriberFromRedis(id, fromInstanceId);
    }));
  };
}

type instanceId = string;

const get1MinuteAgoTimestamp = (): number => Date.now() - 60 * 1000;
