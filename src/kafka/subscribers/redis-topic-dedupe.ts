import { RedisClient } from '../../redis/types';

type AppendResult = 'inserted' | 'duplicate';

type AppendTopicMessageParams = {
  maxMessages: number;
  messagesKey: string;
  offset: string;
  partition: number;
  redisClient: RedisClient;
  serializedMessage: string;
  ttlSeconds: number;
  watermarkKey: string;
};

export const appendTopicMessageWithDedupe = async (
  {
    maxMessages,
    messagesKey,
    offset,
    partition,
    redisClient,
    serializedMessage,
    ttlSeconds,
    watermarkKey,
  }: AppendTopicMessageParams,
): Promise<AppendResult> => {
  const partitionField = partition.toString();
  const currentOffset = await redisClient.hGet(watermarkKey, partitionField);

  if (!isIncomingOffsetNewer(currentOffset, offset)) {
    return 'duplicate';
  }

  await redisClient.multi()
    .rPush(messagesKey, serializedMessage)
    .lTrim(messagesKey, -maxMessages, -1)
    .hSet(watermarkKey, partitionField, offset)
    .expire(messagesKey, ttlSeconds)
    .expire(watermarkKey, ttlSeconds)
    .exec();

  return 'inserted';
};

export const isIncomingOffsetNewer = (
  currentOffset: string | null | undefined,
  incomingOffset: string,
): boolean => {
  if (!currentOffset) {
    return true;
  }
  return compareOffsetStrings(incomingOffset, currentOffset) > 0;
};

export const compareOffsetStrings = (left: string, right: string): number => {
  // Kafka offsets are 64-bit integers and can exceed Number.MAX_SAFE_INTEGER.
  // Keep comparisons in string-space to avoid precision loss in JS numbers.
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  if (left === right) {
    return 0;
  }
  return left > right ? 1 : -1;
};
