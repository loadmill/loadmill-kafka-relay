import { ensureTopicConsumerRunning } from '../../src/kafka/subscribers/topic-consumers-manager';
import { getRedisClient } from '../../src/redis/redis-client';

// Prevent real Kafka/Redis connections
jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/schema-registry', () => ({ decode: jest.fn().mockResolvedValue(undefined) }));

// Mock RedisSubscriber so we control consumer creation and reseekToLatestMessages
const mockReseekToLatestMessages = jest.fn().mockResolvedValue(undefined);
const mockSubscribeAsTopicConsumer = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/kafka/subscribers/redis-subscriber', () => ({
  RedisSubscriber: jest.fn().mockImplementation(() => ({
    consumer: {},
    reseekToLatestMessages: mockReseekToLatestMessages,
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

  it('starts a new consumer by calling subscribeAsTopicConsumer with no arguments', async () => {
    const topic = nextTopic();
    const mockRedisClient = { set: jest.fn().mockResolvedValue('OK') };
    mockGetRedisClient.mockReturnValue(mockRedisClient as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);
    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledWith();
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
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      redisClient.lLen.mockResolvedValue(0);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(redisClient.lLen).toHaveBeenCalledWith(`kafka-relay:topics:${topic}:messages`);
      expect(mockReseekToLatestMessages).toHaveBeenCalledTimes(1);
    });

    it('does not re-seek when messages key is non-empty', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      redisClient.lLen.mockResolvedValue(5);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(mockReseekToLatestMessages).not.toHaveBeenCalled();
    });

    it('accepts the 2-arg function signature and runs correctly', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(redisClient.lLen).toHaveBeenCalledTimes(1);
      expect(mockReseekToLatestMessages).not.toHaveBeenCalled();
    });
  });
});
