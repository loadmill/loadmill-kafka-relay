import {
  TOPIC_CONSUMER_LOOKBACK_MS,
} from '../../src/kafka/subscribers/constants';
import { ensureTopicConsumerRunning } from '../../src/kafka/subscribers/topic-consumers-manager';
import { getRedisClient } from '../../src/redis/redis-client';

// Prevent real Kafka/Redis connections
jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/schema-registry', () => ({ decode: jest.fn().mockResolvedValue(undefined) }));

// Mock RedisSubscriber so we control consumer creation and reseekToTimestamp
const mockReseekToTimestamp = jest.fn().mockResolvedValue(undefined);
const mockSubscribeAsTopicConsumer = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/kafka/subscribers/redis-subscriber', () => ({
  RedisSubscriber: jest.fn().mockImplementation(() => ({
    consumer: {},
    reseekToTimestamp: mockReseekToTimestamp,
    subscribeAsTopicConsumer: mockSubscribeAsTopicConsumer,
  })),
}));

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

const subscribeOptions = { connectionTimeout: undefined, sasl: undefined, ssl: false as const };

// Each test uses a unique topic name so tests don't share the module-level topics Map state
let topicCounter = 0;
const nextTopic = () => `test-topic-${topicCounter++}`;

describe('ensureTopicConsumerRunning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts consumer from lookback when no timestamp is given', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const topic = nextTopic();
      const mockRedisClient = { set: jest.fn().mockResolvedValue('OK') };
      mockGetRedisClient.mockReturnValue(mockRedisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);
      expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledWith(1700000000000 - TOPIC_CONSUMER_LOOKBACK_MS);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('starts consumer from subscriber timestamp when it predates the lookback window', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const oldTimestamp = 1700000000000 - 48 * 60 * 60 * 1000; // 48h ago
      const topic = nextTopic();
      const mockRedisClient = { set: jest.fn().mockResolvedValue('OK') };
      mockGetRedisClient.mockReturnValue(mockRedisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions, oldTimestamp);

      expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledWith(oldTimestamp);
    } finally {
      nowSpy.mockRestore();
    }
  });

  describe('when consumer is already running', () => {
    const seedRunningConsumer = async (topic: string) => {
      const mockRedisClient = { lLen: jest.fn().mockResolvedValue(1), set: jest.fn().mockResolvedValue('OK') };
      mockGetRedisClient.mockReturnValue(mockRedisClient as never);
      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
      jest.clearAllMocks();
      return mockRedisClient;
    };

    it('re-seeks with lookback timestamp when messages key is empty', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const topic = nextTopic();
        const redisClient = await seedRunningConsumer(topic);
        redisClient.lLen.mockResolvedValue(0);
        mockGetRedisClient.mockReturnValue(redisClient as never);

        await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

        expect(redisClient.lLen).toHaveBeenCalledWith(`kafka-relay:topics:${topic}:messages`);
        expect(mockReseekToTimestamp).toHaveBeenCalledWith(
          1700000000000 - TOPIC_CONSUMER_LOOKBACK_MS,
        );
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('does not re-seek when messages key is non-empty', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      redisClient.lLen.mockResolvedValue(5);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(mockReseekToTimestamp).not.toHaveBeenCalled();
    });

    it('accepts the 2-arg function signature and runs correctly', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(redisClient.lLen).toHaveBeenCalledTimes(1);
      expect(mockReseekToTimestamp).not.toHaveBeenCalled();
    });

    it('re-seeks to subscriber timestamp when it predates the consumer start', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const oldTimestamp = 1700000000000 - 48 * 60 * 60 * 1000; // 48h ago
        const topic = nextTopic();
        const redisClient = await seedRunningConsumer(topic);
        redisClient.lLen.mockResolvedValue(5);
        mockGetRedisClient.mockReturnValue(redisClient as never);

        await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions, oldTimestamp);

        // Skips the lLen check entirely; re-seeks directly to the old timestamp
        expect(redisClient.lLen).not.toHaveBeenCalled();
        expect(mockReseekToTimestamp).toHaveBeenCalledWith(oldTimestamp);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('does not re-seek to subscriber timestamp when it is within the consumer start window', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      redisClient.lLen.mockResolvedValue(5);
      mockGetRedisClient.mockReturnValue(redisClient as never);
      const recentTimestamp = Date.now() - 60 * 1000; // 1 min ago, within 24h window

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions, recentTimestamp);

      expect(mockReseekToTimestamp).not.toHaveBeenCalled();
    });
  });
});
