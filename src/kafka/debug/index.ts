import { ConsumedMessage } from '../../types';
import { getSchemaRegistryData } from '../schema-registry';
import { getActiveSubscribers } from '../subscribers';
import {
  RedisSubscriber,
  ShallowRedisSubscribers,
} from '../subscribers/redis-subscriber';
import {
  ShallowSubscribers,
  Subscribers,
} from '../subscribers/subscriber';

type DebugSubscribers = ShallowSubscribers | ShallowRedisSubscribers;

type DebugData = {
  schemaRegistry?: {
    url: string;
  };
  subscriptions: DebugSubscribers;
};

export const getDebugData = async (): Promise<DebugData> => {
  return {
    schemaRegistry: await getSchemaRegistryData(),
    subscriptions: await getSubscriptions(),
  };
};

const getSubscriptions = async (): Promise<DebugSubscribers> => {
  const subscribers = await getActiveSubscribers();
  const shallowSubscribers = toShallowSubscribers(subscribers);
  return shallowSubscribers;
};

const toShallowSubscribers = async (subscribers: Subscribers): Promise<DebugSubscribers> => {
  const shallowSubscribers: (ShallowSubscribers | ShallowRedisSubscribers) = {};
  const subscriberIds = Object.keys(subscribers);
  const messagesResults = await Promise.all(subscriberIds.map(id => subscribers[id].getMessages()));
  subscriberIds.forEach((id, index) => {
    const { timeOfSubscription, topic } = subscribers[id];
    const messages = messagesResults[index];
    shallowSubscribers[id] = {
      instanceId: (subscribers[id] as RedisSubscriber).instanceId,
      messages: truncateMessages(messages),
      timeOfSubscription,
      topic,
    };
  });

  return shallowSubscribers;
};

const truncateMessages = (messages: ConsumedMessage[]): ConsumedMessage[] => {
  return messages.map((message) => {
    const { value, ...rest } = message;
    let truncatedValue = value?.toString().slice(0, 10);
    if (truncatedValue?.length > 10) {
      truncatedValue = truncatedValue + '...';
    }
    return {
      ...rest,
      value: truncatedValue,
    };
  });
};
