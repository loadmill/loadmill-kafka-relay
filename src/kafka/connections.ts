import { Consumer } from 'kafkajs';

import log from '../log';
import { Connections, Subscriber } from '../types';

const connections: Connections = {};

const MAX_OPEN_CONNECTION_TIME_MS = 5 * 1000 * 60; // 5 minutes
const CLOSE_CONNECTIONS_INTERVAL_MS = 1000 * 60; // 60 seconds

const closeOldConnections = async () => {
  const now = Date.now();
  await Promise.all(Object.keys(connections).map(async (id: string) => {
    const subscriber = connections[id];
    const { timeOfSubscription, consumer } = subscriber;
    if (now - timeOfSubscription > MAX_OPEN_CONNECTION_TIME_MS) {
      log.info(`Closing connection ${id}`);
      await consumer.disconnect();
      delete connections[id];
    }
  }));
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

export const removeConnection = async (id: string): Promise<string | undefined> => {
  const subscriber = connections[id];
  if (subscriber) {
    const { consumer } = subscriber;
    await consumer.disconnect();
    delete connections[id];
    return id;
  }
};

export const getActiveConnections = (): Connections => connections;
