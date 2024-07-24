import { Connections, ConsumedMessage, ShallowConnections } from '../../types';
import { getActiveConnections } from '../connections';
import { getSchemaRegistryData } from '../schema-registry';

export type DebugData = {
  schemaRegistry?: {
    url: string;
  };
  subscriptions: ShallowConnections;
};

export const getDebugData = async (): Promise<DebugData> => {
  return {
    schemaRegistry: await getSchemaRegistryData(),
    subscriptions: getSubscriptions(),
  };
};

const getSubscriptions = (): ShallowConnections => {
  const connections = getActiveConnections();
  const shallowConnections = toShallowConnections(connections);
  return shallowConnections;
};

const toShallowConnections = (connections: Connections): ShallowConnections => {
  const shallowConnections: ShallowConnections = {};
  Object.keys(connections).forEach((id) => {
    const { messages, timeOfSubscription, topic } = connections[id];
    shallowConnections[id] = {
      messages: truncateMessages(messages),
      timeOfSubscription,
      topic,
    };
  });
  return shallowConnections;
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
