import { takeOverSubscribers } from '../kafka/subscribers';
import log from '../log';
import { redisClient } from '../redis/client';
import { redisSubscriber } from '../redis/subscriber';

import { SHUTDOWN_CHANNEL } from './redis-channels';
import { instancesPrefixKey, toInstanceKey } from './redis-keys';
import { thisRelayInstanceId } from './relay-instance-id';

if (redisSubscriber) {
  log.info('Subscribing to shutdown channel');
  void redisSubscriber.subscribe(SHUTDOWN_CHANNEL, async (message) => {
    const { from, to } = JSON.parse(message) as { from: string; to: string };
    if (to === thisRelayInstanceId) {
      log.info({ from, to }, 'Received shutdown notification');
      await takeOverSubscribers(from);
    }
  });
}

export const registerInstance = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.zAdd(instancesPrefixKey, { score: Date.now(), value: thisRelayInstanceId });
    log.info({ thisRelayInstanceId }, 'Registered Instance');
  }
};

export const unregisterInstance = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.zRem(instancesPrefixKey, thisRelayInstanceId);
    log.info({ thisRelayInstanceId }, 'Unregistered Instance');
  }
};

const selectRandomInstance = async (): Promise<string | null> => {
  if (!redisClient) {
    return null;
  }
  const instances = await redisClient.zRange(instancesPrefixKey, 0, -1);
  log.info({ instances }, 'Selecting random instance');
  const otherInstances = instances.filter(id => id !== thisRelayInstanceId);
  if (otherInstances.length === 0) {
    log.info('No other instances found');
    return null;
  }
  const randomIndex = Math.floor(Math.random() * otherInstances.length);
  return otherInstances[randomIndex];
};

export const announceShutdown = async (): Promise<void> => {
  log.info({ thisRelayInstanceId }, 'Announcing shutdown');
  if (redisClient) {
    const selectedInstance = await selectRandomInstance();
    if (selectedInstance) {
      await redisClient.publish(SHUTDOWN_CHANNEL, JSON.stringify({ from: thisRelayInstanceId, to: selectedInstance }));
    }
    await redisClient.zRem(toInstanceKey(thisRelayInstanceId), thisRelayInstanceId);
  }
};
