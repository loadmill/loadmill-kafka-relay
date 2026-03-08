import { randomUUID } from 'crypto';

import { createClient } from 'redis';

import { appendTopicMessageWithDedupe } from '../../src/kafka/subscribers/redis-topic-dedupe';

type StoredMessage = {
  offset: string;
  partition: number;
  value: string;
};

const runRedisIntegrationTests = process.env.RUN_REDIS_INTEGRATION_TESTS === 'true';
const describeRedisIntegration = runRedisIntegrationTests ? describe : describe.skip;

describeRedisIntegration('redis topic dedupe integration', () => {
  const TEST_TTL_SECONDS = 5;
  const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });
  let isRedisAvailable = true;

  jest.setTimeout(20000);

  const toTopicMessagesKey = (topic: string): string =>
    `kafka-relay:topics:${encodeURIComponent(topic)}:messages`;

  const toTopicPartitionOffsetWatermarksKey = (topic: string): string =>
    `kafka-relay:topics:${encodeURIComponent(topic)}:partition-offset-watermarks`;

  beforeAll(async () => {
    try {
      await redisClient.connect();
    } catch {
      isRedisAvailable = false;
    }
  });

  afterAll(async () => {
    if (redisClient.isOpen) {
      await redisClient.disconnect();
    }
  });

  it('dedupes repeated sequential writes for the same partition+offset', async () => {
    if (!isRedisAvailable) {
      return;
    }
    const topic = `it-dedupe-${randomUUID()}`;
    const messagesKey = toTopicMessagesKey(topic);
    const watermarkKey = toTopicPartitionOffsetWatermarksKey(topic);
    await redisClient.del([messagesKey, watermarkKey]);

    const first = await appendTopicMessageWithDedupe({
      maxMessages: 5000,
      messagesKey,
      offset: '500',
      partition: 0,
      redisClient,
      serializedMessage: JSON.stringify({
        offset: '500',
        partition: 0,
        value: 'payload-1',
      }),
      ttlSeconds: TEST_TTL_SECONDS,
      watermarkKey,
    });

    const second = await appendTopicMessageWithDedupe({
      maxMessages: 5000,
      messagesKey,
      offset: '500',
      partition: 0,
      redisClient,
      serializedMessage: JSON.stringify({
        offset: '500',
        partition: 0,
        value: 'payload-2',
      }),
      ttlSeconds: TEST_TTL_SECONDS,
      watermarkKey,
    });

    const [serializedMessages, watermark] = await Promise.all([
      redisClient.lRange(messagesKey, 0, -1),
      redisClient.hGet(watermarkKey, '0'),
    ]);

    expect(first).toBe('inserted');
    expect(second).toBe('duplicate');
    expect(serializedMessages).toHaveLength(1);
    expect(watermark).toBe('500');
    const parsed = JSON.parse(serializedMessages[0]) as StoredMessage;
    expect(parsed.partition).toBe(0);
    expect(parsed.offset).toBe('500');
    expect(parsed.value).toBe('payload-1');
  });

  it('dedupes per partition (same offset can be inserted once in each partition)', async () => {
    if (!isRedisAvailable) {
      return;
    }
    const topic = `it-dedupe-${randomUUID()}`;
    const messagesKey = toTopicMessagesKey(topic);
    const watermarkKey = toTopicPartitionOffsetWatermarksKey(topic);
    await redisClient.del([messagesKey, watermarkKey]);

    const results = [];
    results.push(await appendTopicMessageWithDedupe({
      maxMessages: 5000,
      messagesKey,
      offset: '42',
      partition: 0,
      redisClient,
      serializedMessage: JSON.stringify({ offset: '42', partition: 0, value: 'p0' }),
      ttlSeconds: TEST_TTL_SECONDS,
      watermarkKey,
    }));
    results.push(await appendTopicMessageWithDedupe({
      maxMessages: 5000,
      messagesKey,
      offset: '42',
      partition: 1,
      redisClient,
      serializedMessage: JSON.stringify({ offset: '42', partition: 1, value: 'p1' }),
      ttlSeconds: TEST_TTL_SECONDS,
      watermarkKey,
    }));
    results.push(await appendTopicMessageWithDedupe({
      maxMessages: 5000,
      messagesKey,
      offset: '42',
      partition: 0,
      redisClient,
      serializedMessage: JSON.stringify({ offset: '42', partition: 0, value: 'p0-dup' }),
      ttlSeconds: TEST_TTL_SECONDS,
      watermarkKey,
    }));
    results.push(await appendTopicMessageWithDedupe({
      maxMessages: 5000,
      messagesKey,
      offset: '42',
      partition: 1,
      redisClient,
      serializedMessage: JSON.stringify({ offset: '42', partition: 1, value: 'p1-dup' }),
      ttlSeconds: TEST_TTL_SECONDS,
      watermarkKey,
    }));

    const [serializedMessages, watermark0, watermark1] = await Promise.all([
      redisClient.lRange(messagesKey, 0, -1),
      redisClient.hGet(watermarkKey, '0'),
      redisClient.hGet(watermarkKey, '1'),
    ]);

    expect(results).toEqual(['inserted', 'inserted', 'duplicate', 'duplicate']);
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
