import { EachMessagePayload } from '@confluentinc/kafka-javascript/types/kafkajs';

import log from '../../log';
import { getRedisClient } from '../../redis/redis-client';
import { RedisClient } from '../../redis/types';
import { UndecodableMessageError } from '../schema-registry';

import { MAX_TOPIC_MESSAGES_LENGTH, TOPIC_MESSAGES_TTL_SECONDS } from './constants';
import { toTopicSkippedMessagesKey } from './redis-keys';

export type SkippedMessage = {
  offset: string;
  partition: number;
  reason: string;
  schemaId?: number;
  timestamp: number;
};

export const toSkippedMessage = (
  { message, partition }: Pick<EachMessagePayload, 'message' | 'partition'>,
  error: UndecodableMessageError,
): SkippedMessage => ({
  offset: message.offset,
  partition,
  reason: error.reason,
  schemaId: error.schemaId,
  timestamp: Number(message.timestamp),
});

// One error line per skipped message: the offset is committed after this, so it is not re-read.
export const logSkippedMessage = (topic: string, skipped: SkippedMessage): void => {
  log.error(
    { offset: skipped.offset, partition: skipped.partition, schemaId: skipped.schemaId, topic },
    `Skipped undecodable message: ${skipped.reason}`,
  );
};

// Kept beside the topic's messages, with the same TTL and length cap. The member is the message's
// coordinates, so a message seen again after a re-seek is stored once.
export const recordSkippedMessageInRedis = async (
  redisClient: RedisClient,
  topic: string,
  skipped: SkippedMessage,
): Promise<void> => {
  const key = toTopicSkippedMessagesKey(topic);
  await redisClient.multi()
    .zAdd(key, { score: skipped.timestamp, value: JSON.stringify(skipped) })
    .zRemRangeByRank(key, 0, -(MAX_TOPIC_MESSAGES_LENGTH + 1))
    .expire(key, TOPIC_MESSAGES_TTL_SECONDS)
    .exec();
};

export const getSkippedMessagesFromRedis = async (topic: string): Promise<SkippedMessage[]> => {
  const serialized = await getRedisClient().zRange(toTopicSkippedMessagesKey(topic), 0, -1);
  return serialized.map((value: string) => JSON.parse(value) as SkippedMessage);
};

export const describeSkippedMessages = (skipped: SkippedMessage[]): string | undefined => {
  if (skipped.length === 0) {
    return undefined;
  }
  const schemaIds = [...new Set(skipped.map(({ schemaId }) => schemaId).filter((id) => id !== undefined))];
  const schemas = schemaIds.length > 0 ?
    ` (schema ID ${schemaIds.join(', ')} not found in the schema registry)` :
    ' (schema not found in the schema registry)';
  const count = skipped.length === 1 ? '1 message' : `${skipped.length} messages`;
  return `${count} on this topic could not be decoded and ${skipped.length === 1 ? 'was' : 'were'} skipped${schemas}. ` +
    'The message you are waiting for may be one of them: check the producer\'s schema.';
};
