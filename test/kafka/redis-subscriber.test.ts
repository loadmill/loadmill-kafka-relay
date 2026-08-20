import {
  TOPIC_CONSUMER_ASSIGNMENT_POLL_INTERVAL_MS,
  TOPIC_CONSUMER_ASSIGNMENT_TIMEOUT_MS,
} from '../../src/kafka/subscribers/constants';
import { RedisSubscriber } from '../../src/kafka/subscribers/redis-subscriber';
import { ensureTopicConsumerRunning } from '../../src/kafka/subscribers/topic-consumers-manager';
import { getRedisClient } from '../../src/redis/redis-client';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/subscribers/topic-consumers-manager', () => ({
  ensureTopicConsumerRunning: jest.fn(),
}));
jest.mock('../../src/kafka/schema-registry', () => ({ decode: jest.fn().mockResolvedValue(undefined) }));

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;
const mockEnsureTopicConsumerRunning = ensureTopicConsumerRunning as jest.MockedFunction<typeof ensureTopicConsumerRunning>;

describe('RedisSubscriber.reseekToLatestMessages', () => {
  const subscribeParams = { brokers: ['kafka:9092'], topic: 'test-topic' };
  const watermarkKey = 'kafka-relay:topics:v3:test-topic:partition-offset-watermarks';

  const makeConsumer = () => ({ seek: jest.fn() });

  const makeKafka = (partitions: { high: string; low: string; offset: string; partition: number }[]) => {
    const admin = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      fetchTopicOffsets: jest.fn().mockResolvedValue(partitions),
    };
    return { _admin: admin, admin: jest.fn().mockReturnValue(admin) };
  };

  const makeRedisClient = () => ({ del: jest.fn().mockResolvedValue(1) });

  const createSubscriber = (redisClient: ReturnType<typeof makeRedisClient>) => {
    mockGetRedisClient.mockReturnValue(redisClient as never);
    return new RedisSubscriber(subscribeParams, {});
  };

  it('throws when consumer is not initialized', async () => {
    const subscriber = createSubscriber(makeRedisClient());
    await expect(subscriber.reseekToLatestMessages()).rejects.toThrow(
      'Kafka consumer is not initialized',
    );
  });

  it('throws when kafka is not initialized', async () => {
    const subscriber = createSubscriber(makeRedisClient());
    subscriber.consumer = makeConsumer() as never;
    await expect(subscriber.reseekToLatestMessages()).rejects.toThrow(
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
    const { admin: kafkaAdmin } = makeKafka([{ high: '5', low: '0', offset: '0', partition: 0 }]);

    const subscriber = createSubscriber(redisClient as never);
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.reseekToLatestMessages();

    expect(callOrder[0]).toBe('del');
    expect(callOrder).toContain('seek');
    expect(redisClient.del).toHaveBeenCalledWith(watermarkKey);
  });

  it('seeks every partition returned by the admin client', async () => {
    const redisClient = makeRedisClient();
    const consumer = makeConsumer();
    const partitions = [
      { high: '10', low: '0', offset: '0', partition: 0 },
      { high: '20', low: '0', offset: '0', partition: 1 },
      { high: '30', low: '0', offset: '0', partition: 2 },
    ];
    const { _admin: admin, admin: kafkaAdmin } = makeKafka(partitions);

    const subscriber = createSubscriber(redisClient as never);
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.reseekToLatestMessages();

    expect(admin.fetchTopicOffsets).toHaveBeenCalledWith('test-topic');
    expect(consumer.seek).toHaveBeenCalledTimes(3);
    expect(consumer.seek).toHaveBeenCalledWith({ offset: '0', partition: 0, topic: 'test-topic' });
    expect(consumer.seek).toHaveBeenCalledWith({ offset: '0', partition: 1, topic: 'test-topic' });
    expect(consumer.seek).toHaveBeenCalledWith({ offset: '0', partition: 2, topic: 'test-topic' });
  });

  it('deletes watermark for the correct topic key', async () => {
    const redisClient = makeRedisClient();
    const { admin: kafkaAdmin } = makeKafka([{ high: '1', low: '0', offset: '0', partition: 0 }]);

    const subscriber = createSubscriber(redisClient as never);
    subscriber.consumer = makeConsumer() as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.reseekToLatestMessages();

    expect(redisClient.del).toHaveBeenCalledTimes(1);
    expect(redisClient.del).toHaveBeenCalledWith(watermarkKey);
  });
});

describe('RedisSubscriber.subscribeAsTopicConsumer', () => {
  const subscribeParams = { brokers: ['kafka:9092'], topic: 'test-topic' };

  const makeKafka = (partitions: { high: string; low: string; offset: string; partition: number }[]) => {
    const admin = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      fetchTopicOffsets: jest.fn().mockResolvedValue(partitions),
    };
    return { _admin: admin, admin: jest.fn().mockReturnValue(admin) };
  };

  const makeRedisClient = () => ({ del: jest.fn().mockResolvedValue(1) });

  const createSubscriber = () => {
    mockGetRedisClient.mockReturnValue(makeRedisClient() as never);
    return new RedisSubscriber(subscribeParams, {});
  };

  it('computes seek offset from high/low', async () => {
    const callOrder: string[] = [];
    const consumer = {
      assignment: jest.fn().mockReturnValue([{ partition: 0, topic: 'test-topic' }]),
      connect: jest.fn().mockImplementation(async () => {
        callOrder.push('connect');
      }),
      run: jest.fn().mockImplementation(async () => {
        callOrder.push('run');
      }),
      seek: jest.fn().mockImplementation(() => {
        callOrder.push('seek');
      }),
      subscribe: jest.fn().mockImplementation(async () => {
        callOrder.push('subscribe');
      }),
    };
    const { _admin: admin, admin: kafkaAdmin } = makeKafka([
      { high: '5010', low: '0', offset: '0', partition: 0 },
    ]);
    admin.fetchTopicOffsets.mockImplementation(async () => {
      callOrder.push('fetchTopicOffsets');
      return [{ high: '5010', low: '0', offset: '0', partition: 0 }];
    });

    const subscriber = createSubscriber();
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.subscribeAsTopicConsumer();

    expect(consumer.seek).toHaveBeenCalledWith({ offset: '10', partition: 0, topic: 'test-topic' });
    expect(admin.fetchTopicOffsets).toHaveBeenCalledWith('test-topic');
    expect(callOrder).toEqual(['connect', 'fetchTopicOffsets', 'subscribe', 'run', 'seek']);
  });

  it('clamps to low when topic has fewer than 5000 messages', async () => {
    const callOrder: string[] = [];
    const consumer = {
      assignment: jest.fn().mockReturnValue([{ partition: 0, topic: 'test-topic' }]),
      connect: jest.fn().mockImplementation(async () => {
        callOrder.push('connect');
      }),
      run: jest.fn().mockImplementation(async () => {
        callOrder.push('run');
      }),
      seek: jest.fn().mockImplementation(() => {
        callOrder.push('seek');
      }),
      subscribe: jest.fn().mockImplementation(async () => {
        callOrder.push('subscribe');
      }),
    };
    const { _admin: admin, admin: kafkaAdmin } = makeKafka([
      { high: '100', low: '0', offset: '0', partition: 0 },
    ]);
    admin.fetchTopicOffsets.mockImplementation(async () => {
      callOrder.push('fetchTopicOffsets');
      return [{ high: '100', low: '0', offset: '0', partition: 0 }];
    });

    const subscriber = createSubscriber();
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await subscriber.subscribeAsTopicConsumer();

    expect(consumer.seek).toHaveBeenCalledWith({ offset: '0', partition: 0, topic: 'test-topic' });
    expect(callOrder).toEqual(['connect', 'fetchTopicOffsets', 'subscribe', 'run', 'seek']);
  });

  it('disconnects the admin client when fetching topic offsets fails', async () => {
    const consumer = {
      assignment: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    const { _admin: admin, admin: kafkaAdmin } = makeKafka([]);
    const fetchError = new Error('offset lookup failed');
    admin.fetchTopicOffsets.mockRejectedValue(fetchError);
    const subscriber = createSubscriber();
    subscriber.consumer = consumer as never;
    subscriber.kafka = { admin: kafkaAdmin } as never;

    await expect(subscriber.subscribeAsTopicConsumer()).rejects.toThrow(fetchError);

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('waits for the expected topic partition assignment', async () => {
    jest.useFakeTimers();
    try {
      const consumer = {
        assignment: jest.fn()
          .mockReturnValueOnce([{ partition: 0, topic: 'test-topic' }])
          .mockReturnValueOnce([{ partition: 0, topic: 'test-topic' }])
          .mockReturnValue([
            { partition: 0, topic: 'test-topic' },
            { partition: 1, topic: 'test-topic' },
          ]),
        connect: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue(undefined),
        seek: jest.fn(),
        subscribe: jest.fn().mockResolvedValue(undefined),
      };
      const { admin: kafkaAdmin } = makeKafka([
        { high: '10', low: '0', offset: '0', partition: 0 },
        { high: '10', low: '0', offset: '0', partition: 1 },
      ]);
      const subscriber = createSubscriber();
      subscriber.consumer = consumer as never;
      subscriber.kafka = { admin: kafkaAdmin } as never;

      const subscribing = subscriber.subscribeAsTopicConsumer();
      await jest.advanceTimersByTimeAsync(TOPIC_CONSUMER_ASSIGNMENT_POLL_INTERVAL_MS * 2);
      await subscribing;

      expect(consumer.assignment).toHaveBeenCalledTimes(3);
      expect(subscriber.isTopicConsumerCaptureReady()).toBe(true);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('rejects startup when partition assignment never becomes ready', async () => {
    jest.useFakeTimers();
    try {
      const consumer = {
        assignment: jest.fn().mockReturnValue([]),
        connect: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue(undefined),
        seek: jest.fn(),
        subscribe: jest.fn().mockResolvedValue(undefined),
      };
      const { admin: kafkaAdmin } = makeKafka([
        { high: '10', low: '0', offset: '0', partition: 0 },
      ]);
      const subscriber = createSubscriber();
      subscriber.consumer = consumer as never;
      subscriber.kafka = { admin: kafkaAdmin } as never;
      const subscribing = expect(subscriber.subscribeAsTopicConsumer()).rejects.toThrow(
        'Timed out waiting for Kafka partition assignment for test-topic',
      );

      await jest.advanceTimersByTimeAsync(TOPIC_CONSUMER_ASSIGNMENT_TIMEOUT_MS);
      await subscribing;
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('RedisSubscriber.subscribe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRedisClient.mockReturnValue({ del: jest.fn().mockResolvedValue(1) } as never);
  });

  it('calls ensureTopicConsumerRunning with brokers and options', async () => {
    const subscriber = new RedisSubscriber({ brokers: ['kafka:9092'], topic: 'test-topic' }, {});

    await subscriber.subscribe();

    expect(mockEnsureTopicConsumerRunning).toHaveBeenCalledTimes(1);
    expect(mockEnsureTopicConsumerRunning).toHaveBeenCalledWith(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      { connectionTimeout: undefined, sasl: undefined, ssl: false },
    );
  });
});
