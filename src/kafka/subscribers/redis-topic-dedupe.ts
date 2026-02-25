import { RedisClient } from '../../redis/types';

type AppendResult = 'inserted' | 'duplicate';
type AppendAttemptResult = AppendResult | 'conflict';

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

const WATCH_CONFLICT_MAX_RETRIES = 8;
const WATCH_CONFLICT_BACKOFF_MIN_MS = 5;
const WATCH_CONFLICT_BACKOFF_MAX_MS = 30;

export const appendTopicMessageWithDedupe = async (
  params: AppendTopicMessageParams,
): Promise<AppendResult> => {
  for (let attempt = 1; attempt <= WATCH_CONFLICT_MAX_RETRIES; attempt += 1) {
    const result = await attemptAtomicAppendWithWatch(params);
    if (result !== 'conflict') {
      return result;
    }
    await sleep(getWatchConflictBackoffMs());
  }

  throw new Error(`Failed to append deduped topic message after ${WATCH_CONFLICT_MAX_RETRIES} WATCH conflicts`);
};

const attemptAtomicAppendWithWatch = async (
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
): Promise<AppendAttemptResult> => {
  return await redisClient.executeIsolated(async (isolatedRedisClient) => {
    const partitionField = partition.toString();
    await isolatedRedisClient.watch(watermarkKey);
    const currentOffset = await isolatedRedisClient.hGet(watermarkKey, partitionField);

    if (!isIncomingOffsetNewer(currentOffset, offset)) {
      await isolatedRedisClient.unwatch();
      return 'duplicate';
    }

    const transactionResult = await isolatedRedisClient.multi()
      .rPush(messagesKey, serializedMessage)
      .lTrim(messagesKey, -maxMessages, -1)
      .hSet(watermarkKey, partitionField, offset)
      .expire(messagesKey, ttlSeconds)
      .expire(watermarkKey, ttlSeconds)
      .exec();

    if (transactionResult === null) {
      return 'conflict';
    }

    return 'inserted';
  });
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

const getWatchConflictBackoffMs = (): number => {
  return Math.floor(
    Math.random() * (WATCH_CONFLICT_BACKOFF_MAX_MS - WATCH_CONFLICT_BACKOFF_MIN_MS + 1),
  ) + WATCH_CONFLICT_BACKOFF_MIN_MS;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};
