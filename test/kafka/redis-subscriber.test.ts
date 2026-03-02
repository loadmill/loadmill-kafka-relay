import { RedisSubscriber } from '../../src/kafka/subscribers/redis-subscriber';
import { getRedisClient } from '../../src/redis/redis-client';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/subscribers/topic-consumers-manager', () => ({
  ensureTopicConsumerRunning: jest.fn(),
}));
jest.mock('../../src/kafka/schema-registry', () => ({ decode: jest.fn().mockResolvedValue(undefined) }));

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

describe('RedisSubscriber.reseekToTimestamp', () => {
  const subscribeParams = { brokers: ['kafka:9092'], topic: 'test-topic' };
  const watermarkKey = 'kafka-relay:topics:test-topic:partition-offset-watermarks';

  const makeConsumer = () => ({ seek: jest.fn() });

  const makeKafka = (partitions: { offset: string; partition: number }[]) => {
    const admin = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      fetchTopicOffsetsByTimestamp: jest.fn().mockResolvedValue(partitions),
    };
    return { _admin: admin, admin: jest.fn().mockReturnValue(admin) };
  };

  const makeRedisClient = () => ({ del: jest.fn().mockResolvedValue(1) });

  const createSubscriber = (redisClient: ReturnType<typeof makeRedisClient>) => {
    mockGetRedisClient.mockReturnValue(redisClient as never);
    // asTopicConsumer defaults to false → consumer and kafka are left undefined
    return new RedisSubscriber(subscribeParams, {});
  };

  it('throws when consumer is not initialized', async () => {
    const subscriber = createSubscriber(makeRedisClient());
    // kafka is also undefined, but the guard checks both together
    await expect(subscriber.reseekToTimestamp(12345)).rejects.toThrow(
      'Kafka consumer is not initialized',
    );
  });

  it('throws when kafka is not initialized', async () => {
    const subscriber = createSubscriber(makeRedisClient());
    subscriber.consumer = makeConsumer() as never;
    // kafka is still undefined
    await expect(subscriber.reseekToTimestamp(12345)).rejects.toThrow(
      'Kafka consumer is not initialized',
    );
  });

  it('deletes the watermark key before seeking any partition', async () => {
    const callOrder: string[] = [];
    const redisClient = {
      del: jest.fn().mockImplementation(() => {
        callOrder.push('del');
        return Promise.resolve(1);
      }),
    };
    const consumer = {
      seek: jest.fn().mockImplementation(() => {
        callOrder.push('seek');
      }),
    };
    const { _admin: admin, admin: kafkaAdmin } = makeKafka([{ offset: '5', partition: 0 }]);
    admin.fetchTopicOffsetsByTimestamp.mockResolvedValue([{ offset: '5', partition: 0 }]);

    const subscriber = createSubscriber(redisClient as never);
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.reseekToTimestamp(1000);

    expect(callOrder[0]).toBe('del');
    expect(callOrder).toContain('seek');
    expect(redisClient.del).toHaveBeenCalledWith(watermarkKey);
  });

  it('seeks every partition returned by the admin client', async () => {
    const redisClient = makeRedisClient();
    const consumer = makeConsumer();
    const partitions = [
      { offset: '10', partition: 0 },
      { offset: '20', partition: 1 },
      { offset: '30', partition: 2 },
    ];
    const { _admin: admin, admin: kafkaAdmin } = makeKafka(partitions);

    const subscriber = createSubscriber(redisClient as never);
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.reseekToTimestamp(99999);

    expect(admin.fetchTopicOffsetsByTimestamp).toHaveBeenCalledWith('test-topic', 99999);
    expect(consumer.seek).toHaveBeenCalledTimes(3);
    expect(consumer.seek).toHaveBeenCalledWith({ offset: '10', partition: 0, topic: 'test-topic' });
    expect(consumer.seek).toHaveBeenCalledWith({ offset: '20', partition: 1, topic: 'test-topic' });
    expect(consumer.seek).toHaveBeenCalledWith({ offset: '30', partition: 2, topic: 'test-topic' });
  });

  it('deletes watermark for the correct topic key', async () => {
    const redisClient = makeRedisClient();
    const { admin: kafkaAdmin } = makeKafka([{ offset: '0', partition: 0 }]);

    const subscriber = createSubscriber(redisClient as never);
    subscriber.consumer = makeConsumer() as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.reseekToTimestamp(1000);

    expect(redisClient.del).toHaveBeenCalledTimes(1);
    expect(redisClient.del).toHaveBeenCalledWith(watermarkKey);
  });
});
