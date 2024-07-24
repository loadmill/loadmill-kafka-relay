import { ConsumedMessage, ShallowSubscribers } from '../../types';
import { getSchemaRegistryData } from '../schema-registry';
import { getActiveSubscribers } from '../subscribers';
import { Subscribers } from '../subscribers/subscriber';

export type DebugData = {
  schemaRegistry?: {
    url: string;
  };
  subscriptions: ShallowSubscribers;
};

export const getDebugData = async (): Promise<DebugData> => {
  return {
    schemaRegistry: await getSchemaRegistryData(),
    subscriptions: await getSubscriptions(),
  };
};

const getSubscriptions = async (): Promise<ShallowSubscribers> => {
  const subscribers = getActiveSubscribers();
  const shallowSubscribers = toShallowSubscribers(subscribers);
  return shallowSubscribers;
};

const toShallowSubscribers = async (subscribers: Subscribers): Promise<ShallowSubscribers> => {
  const shallowSubscribers: ShallowSubscribers = {};
  const subscriberIds = Object.keys(subscribers);
  const messagesResults = await Promise.all(subscriberIds.map(id => subscribers[id].getMessages()));
  subscriberIds.forEach((id, index) => {
    const { timeOfSubscription, topic } = subscribers[id];
    const messages = messagesResults[index];
    shallowSubscribers[id] = {
      id,
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
    return {
      ...rest,
      value: value?.toString().slice(0, 10) + '...',
    };
  });
};
