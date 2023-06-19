import { Consumer } from 'kafkajs';

import log from '../log';
import { Connections, Subscriber } from '../types';

export const connections: Connections = {};

const MAX_OPEN_CONNECTION_TIME_MS = 10 * 1000 * 60; // 10 minutes
const CLOSE_CONNECTIONS_INTERVAL_MS = 1000 * 60; // 60 seconds

const closeOldConnections = () => {
  const now = Date.now();
  Object.keys(connections).forEach((id: string) => {
    const subscriber = connections[id];
    const { timeOfSubscription, consumer } = subscriber;
    if (now - timeOfSubscription > MAX_OPEN_CONNECTION_TIME_MS) {
      log.info(`Closing connection ${id}`);
      consumer.disconnect();
      delete connections[id];
    }
  });
};

export const startCloseOldConnectionsInterval = (): void => {
  setInterval(closeOldConnections, CLOSE_CONNECTIONS_INTERVAL_MS);
};

export const addConnection = (id: string, consumer: Consumer, topic: string): Subscriber => {
  connections[id] = {
    consumer,
    messages: [],
    timeOfSubscription: Date.now(),
    topic,
  };
  return connections[id];
};

export const getConnection = (id: string): Subscriber => connections[id];
