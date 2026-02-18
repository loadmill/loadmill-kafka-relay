import { ConsumedMessage } from '../../types';
import { getSchemaRegistryData } from '../schema-registry';
import { getActiveSubscribers } from '../subscribers';
import {
  RedisSubscriber,
} from '../subscribers/redis-subscriber';
import {
  Subscribers,
} from '../subscribers/subscriber';

type DebugSubscriber = {
  instanceId?: string;
  messages: ConsumedMessage[];
  messagesCount: number;
  timeOfSubscription: number;
  topic: string;
};

type DebugSubscribers = { [id: string]: DebugSubscriber };

const DEBUG_MESSAGE_SAMPLE_SIZE = 10;

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
  const shallowSubscribers = await toShallowSubscribers(subscribers);
  return shallowSubscribers;
};

const toShallowSubscribers = async (subscribers: Subscribers): Promise<DebugSubscribers> => {
  const shallowSubscribers: DebugSubscribers = {};
  const subscriberIds = Object.keys(subscribers);
  const messagesResults = await Promise.all(subscriberIds.map(id => subscribers[id].getMessages()));
  subscriberIds.forEach((id, index) => {
    const subscriber = subscribers[id];
    const { timeOfSubscription, topic } = subscriber;
    const messages = messagesResults[index];
    const sampledMessages = getLastN(messages, DEBUG_MESSAGE_SAMPLE_SIZE);
    shallowSubscribers[id] = {
      instanceId: subscriber instanceof RedisSubscriber ? subscriber.instanceId : undefined,
      messages: truncateMessages(sampledMessages),
      messagesCount: messages.length,
      timeOfSubscription,
      topic,
    };
  });

  return shallowSubscribers;
};

const getLastN = <T>(arr: T[], n: number): T[] => {
  if (arr.length <= n) {
    return arr;
  }
  return arr.slice(arr.length - n);
};

const truncateMessages = (messages: ConsumedMessage[]): ConsumedMessage[] => {
  return messages.map((message) => {
    const { value, ...rest } = message;
    let truncatedValue = JSON.stringify(value)?.slice(0, 10);
    if (truncatedValue?.length > 10) {
      truncatedValue = truncatedValue + '...';
    }
    return {
      ...rest,
      value: truncatedValue,
    };
  });
};
