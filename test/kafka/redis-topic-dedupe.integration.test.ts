import { randomUUID } from 'crypto';

import { createClient } from 'redis';

import { appendTopicMessageWithDedupe } from '../../src/kafka/subscribers/redis-topic-dedupe';

type StoredMessage = {
  offset: string;
  partition: number;
  value: string;
};

describe('redis topic dedupe integration', () => {
  const TEST_TTL_SECONDS = 5;
  const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  jest.setTimeout(20000);

  const toTopicMessagesKey = (topic: string): string =>
    `kafka-relay:topics:${encodeURIComponent(topic)}:messages`;

  const toTopicPartitionOffsetWatermarksKey = (topic: string): string =>
    `kafka-relay:topics:${encodeURIComponent(topic)}:partition-offset-watermarks`;

  beforeAll(async () => {
    await redisClient.connect();
  });

  afterAll(async () => {
    await redisClient.disconnect();
  });

  it('stores only one message for many concurrent writes of the same partition+offset', async () => {
    const topic = `it-dedupe-${randomUUID()}`;
    const messagesKey = toTopicMessagesKey(topic);
    const watermarkKey = toTopicPartitionOffsetWatermarksKey(topic);
    await redisClient.del([messagesKey, watermarkKey]);

    const calls = Array.from({ length: 100 }, (_, i) =>
      appendTopicMessageWithDedupe({
        maxMessages: 5000,
        messagesKey,
        offset: '500',
        partition: 0,
        redisClient,
        serializedMessage: JSON.stringify({
          offset: '500',
          partition: 0,
          value: `payload-${i}`,
        }),
        ttlSeconds: TEST_TTL_SECONDS,
        watermarkKey,
      }),
    );

    await Promise.all(calls);

    const [serializedMessages, watermark] = await Promise.all([
      redisClient.lRange(messagesKey, 0, -1),
      redisClient.hGet(watermarkKey, '0'),
    ]);

    expect(serializedMessages).toHaveLength(1);
    expect(watermark).toBe('500');
    const parsed = JSON.parse(serializedMessages[0]) as StoredMessage;
    expect(parsed.partition).toBe(0);
    expect(parsed.offset).toBe('500');
  });

  it('dedupes per partition (same offset can be inserted once in each partition)', async () => {
    const topic = `it-dedupe-${randomUUID()}`;
    const messagesKey = toTopicMessagesKey(topic);
    const watermarkKey = toTopicPartitionOffsetWatermarksKey(topic);
    await redisClient.del([messagesKey, watermarkKey]);

    const calls = [
      ...Array.from({ length: 50 }, (_, i) =>
        appendTopicMessageWithDedupe({
          maxMessages: 5000,
          messagesKey,
          offset: '42',
          partition: 0,
          redisClient,
          serializedMessage: JSON.stringify({ offset: '42', partition: 0, value: `p0-${i}` }),
          ttlSeconds: TEST_TTL_SECONDS,
          watermarkKey,
        }),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        appendTopicMessageWithDedupe({
          maxMessages: 5000,
          messagesKey,
          offset: '42',
          partition: 1,
          redisClient,
          serializedMessage: JSON.stringify({ offset: '42', partition: 1, value: `p1-${i}` }),
          ttlSeconds: TEST_TTL_SECONDS,
          watermarkKey,
        }),
      ),
    ];

    await Promise.all(calls);

    const [serializedMessages, watermark0, watermark1] = await Promise.all([
      redisClient.lRange(messagesKey, 0, -1),
      redisClient.hGet(watermarkKey, '0'),
      redisClient.hGet(watermarkKey, '1'),
    ]);

    expect(watermark0).toBe('42');
    expect(watermark1).toBe('42');
    expect(serializedMessages).toHaveLength(2);
    const uniquePartitionOffsets = new Set(
      serializedMessages.map((message) => {
        const parsed = JSON.parse(message) as StoredMessage;
        return `${parsed.partition}:${parsed.offset}`;
      }),
    );
    expect(uniquePartitionOffsets.size).toBe(2);
  });
});
