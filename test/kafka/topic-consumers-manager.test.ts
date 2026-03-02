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

  describe('when consumer is already running', () => {
    const seedRunningConsumer = async (topic: string) => {
      const mockRedisClient = { lLen: jest.fn().mockResolvedValue(1), set: jest.fn().mockResolvedValue('OK') };
      mockGetRedisClient.mockReturnValue(mockRedisClient as never);
      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
      jest.clearAllMocks();
      return mockRedisClient;
    };

    it('re-seeks when timestamp is provided and messages key is empty', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      redisClient.lLen.mockResolvedValue(0);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions, 99999);

      expect(redisClient.lLen).toHaveBeenCalledWith(`kafka-relay:topics:${topic}:messages`);
      expect(mockReseekToTimestamp).toHaveBeenCalledWith(99999);
    });

    it('does not re-seek when timestamp is provided but messages key is non-empty', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      redisClient.lLen.mockResolvedValue(5);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions, 99999);

      expect(mockReseekToTimestamp).not.toHaveBeenCalled();
    });

    it('does not read Redis or re-seek when no timestamp is given', async () => {
      const topic = nextTopic();
      const redisClient = await seedRunningConsumer(topic);
      mockGetRedisClient.mockReturnValue(redisClient as never);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions, undefined);

      expect(redisClient.lLen).not.toHaveBeenCalled();
      expect(mockReseekToTimestamp).not.toHaveBeenCalled();
    });
  });
});
