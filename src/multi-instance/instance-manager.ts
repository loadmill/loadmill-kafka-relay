import { takeOverSubscribers } from '../kafka/subscribers';
import log from '../log';
import { getRedisClient } from '../redis/get-redis-client';
import { getRedisSubscriberClient } from '../redis/get-redis-subscriber-client';

import { SHUTDOWN_CHANNEL } from './redis-channels';
import { instancesPrefixKey } from './redis-keys';
import { thisRelayInstanceId } from './relay-instance-id';

const redisSubscriberClient = getRedisSubscriberClient();
const redisClient = getRedisClient();

export const subscribeToShutdownAnnouncement = async (): Promise<void> => {
  if (redisSubscriberClient) {
    await redisSubscriberClient.subscribe(
      SHUTDOWN_CHANNEL,
      handleShutdownAnnouncement,
    );
  }
};

const handleShutdownAnnouncement = async <T extends string>(message: T) => {
  const { from, to } = JSON.parse(message) as { from: string; to: string };
  if (to === thisRelayInstanceId) {
    log.info({ from, to }, 'Received shutdown announcement');
    await takeOverSubscribers(from);
  }
};

export const registerInstance = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.zAdd(instancesPrefixKey, { score: Date.now(), value: thisRelayInstanceId });
    log.info({ thisRelayInstanceId }, 'Registered Instance');
  }
};

export const onShutdown = async (): Promise<void> => {
  log.info('Starting shutdown process');
  await unregisterInstance();
  await announceShutdown();
  await cleanupOnShutdown();
  log.info('Completed shutdown process');
};

const unregisterInstance = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.zRem(instancesPrefixKey, thisRelayInstanceId);
    log.info({ thisRelayInstanceId }, 'Unregistered Instance');
  }
};

const announceShutdown = async (): Promise<void> => {
  if (redisClient) {
    log.info({ thisRelayInstanceId }, 'Announcing shutdown');
    log.info('Selecting random other relay instance');
    const selectedInstance = await selectRandomInstance();
    if (!selectedInstance) {
      log.info('No other relay instance found');
      return;
    }
    log.info({ selectedInstance }, 'Announcing shutdown to selected instance');
    await redisClient.publish(SHUTDOWN_CHANNEL, JSON.stringify({ from: thisRelayInstanceId, to: selectedInstance }));
  }
};

const selectRandomInstance = async (): Promise<string | undefined> => {
  if (redisClient) {
    const instances = await redisClient.zRange(instancesPrefixKey, 0, -1);
    log.info({ instances }, 'Available relay instances');
    const otherInstances = instances.filter(id => id !== thisRelayInstanceId);
    if (otherInstances.length > 0) {
      const randomIndex = Math.floor(Math.random() * otherInstances.length);
      return otherInstances[randomIndex];
    }
  }
};

const cleanupOnShutdown = async (): Promise<void> => {
  if (redisSubscriberClient) {
    await redisSubscriberClient.unsubscribe(SHUTDOWN_CHANNEL);
    log.info(`Unsubscribed redis subscriber client from ${SHUTDOWN_CHANNEL}`);
    await redisSubscriberClient.disconnect();
    log.info('Disconnected redis subscriber client');
  }
  if (redisClient) {
    await redisClient.disconnect();
    log.info('Disconnected redis client');
  }
};
