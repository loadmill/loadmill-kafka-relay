import { getMessagesFromRedis } from '../../src/kafka/subscribers/redis-messages';
import { RedisSubscribersManager } from '../../src/kafka/subscribers/redis-subscribers-manager';
import { ensureTopicConsumerRunning } from '../../src/kafka/subscribers/topic-consumers-manager';
import {
  getRedisClient,
  getRedisSubscriberClient,
} from '../../src/redis/redis-client';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/subscribers/redis-messages', () => ({
  ...jest.requireActual('../../src/kafka/subscribers/redis-messages'),
  getMessagesFromRedis: jest.fn(),
}));
jest.mock('../../src/kafka/subscribers/topic-consumers-manager', () => ({
  ensureTopicConsumerRunning: jest.fn(),
}));
jest.mock('../../src/kafka/subscribers/redis-subscriber', () => {
  let idCounter = 0;

  class MockRedisSubscriber {
    consumer?: { disconnect: jest.Mock };
    id: string;
    instanceId: string;
    kafkaConfig: { brokers: string[]; connectionTimeout?: number; sasl?: unknown; ssl: boolean };
    timeOfSubscription: number;
    topic: string;
    subscribe = jest.fn().mockResolvedValue(undefined);

    constructor(
      { brokers, topic }: { brokers: string[]; topic: string },
      { connectionTimeout, sasl, ssl = false }: { connectionTimeout?: number; sasl?: unknown; ssl?: boolean },
      options?: {
        debugParams?: { instanceId: string };
        takeOverParams?: { id: string; timeOfSubscription: number };
      },
    ) {
      this.id = options?.takeOverParams?.id ?? `mock-subscriber-${idCounter++}`;
      this.instanceId = options?.debugParams?.instanceId ?? 'test-instance';
      this.kafkaConfig = { brokers, connectionTimeout, sasl, ssl };
      this.timeOfSubscription = options?.takeOverParams?.timeOfSubscription ?? Date.now();
      this.topic = topic;
    }
  }

  return { RedisSubscriber: MockRedisSubscriber };
});

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;
const mockGetRedisSubscriberClient = getRedisSubscriberClient as jest.MockedFunction<typeof getRedisSubscriberClient>;
const mockGetMessagesFromRedis = getMessagesFromRedis as jest.MockedFunction<typeof getMessagesFromRedis>;
const mockEnsureTopicConsumerRunning = ensureTopicConsumerRunning as jest.MockedFunction<typeof ensureTopicConsumerRunning>;

type MockRedis = {
  get: jest.Mock;
  keys: jest.Mock;
  multi: jest.Mock;
  publish: jest.Mock;
  set: jest.Mock;
  subscribe: jest.Mock;
};

const createRedisMocks = (): { redisClient: MockRedis; redisSubscriberClient: MockRedis } => {
  const redisClient: MockRedis = {
    get: jest.fn(),
    keys: jest.fn(),
    multi: jest.fn().mockReturnValue({
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    publish: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
    subscribe: jest.fn(),
  };

  const redisSubscriberClient: MockRedis = {
    ...redisClient,
    subscribe: jest.fn().mockResolvedValue(undefined),
  };

  return { redisClient, redisSubscriberClient };
};

describe('RedisSubscribersManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('getMessages returns all messages for local subscribers', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    mockGetMessagesFromRedis.mockResolvedValue([
      { timestamp: '100', value: 'a' } as never,
      { timestamp: '200', value: 'b' } as never,
      { timestamp: '300', value: 'c' } as never,
    ]);
    const manager = new RedisSubscribersManager();
    const subscriber = await manager.add(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      { connectionTimeout: undefined, sasl: undefined, ssl: false },
    );

    const messages = await manager.getMessages(subscriber.id);

    expect(mockEnsureTopicConsumerRunning).toHaveBeenCalled();
    expect(messages.map(m => Number(m.timestamp))).toEqual([100, 200, 300]);
  });

  it('getMessages returns all messages for cross-instance subscribers', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    mockGetMessagesFromRedis.mockResolvedValue([
      { timestamp: '100', value: 'a' } as never,
      { timestamp: '200', value: 'b' } as never,
      { timestamp: '300', value: 'c' } as never,
    ]);
    const serializedSubscriber = JSON.stringify({
      id: 'sub-remote',
      instanceId: 'remote-instance',
      kafkaConfig: { brokers: ['kafka:9092'], connectionTimeout: undefined, sasl: undefined, ssl: false },
      timeOfSubscription: 1700000000000,
      topic: 'test-topic',
    });
    redisClient.keys.mockResolvedValue(['kafka-relay:remote-instance:subscribers:sub-remote']);
    redisClient.get.mockResolvedValueOnce(serializedSubscriber);
    const manager = new RedisSubscribersManager();

    const messages = await manager.getMessages('sub-remote');

    expect(mockEnsureTopicConsumerRunning).toHaveBeenCalled();
    expect(messages.map(m => Number(m.timestamp))).toEqual([100, 200, 300]);
  });

  it('getMessages passes options to getMessagesFromRedis for local subscribers', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    mockGetMessagesFromRedis.mockResolvedValue([
      { timestamp: '200', value: 'order-ABC-match' } as never,
    ]);
    const manager = new RedisSubscribersManager();
    const subscriber = await manager.add(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      { connectionTimeout: undefined, sasl: undefined, ssl: false },
    );

    const options = { multiple: 1, valueRegex: /order-ABC/ };
    await manager.getMessages(subscriber.id, options);

    expect(mockGetMessagesFromRedis).toHaveBeenCalledWith('test-topic', options);
  });

  it('takeOverSubscribers calls subscribe on each taken-over subscriber', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    const multiDel = jest.fn().mockReturnThis();
    const multiExec = jest.fn().mockResolvedValue([]);
    redisClient.multi.mockReturnValue({ del: multiDel, exec: multiExec });
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    const serializedSubscriber = JSON.stringify({
      id: 'sub-takeover',
      instanceId: 'from-instance',
      kafkaConfig: { brokers: ['kafka:9092'], connectionTimeout: undefined, sasl: undefined, ssl: false },
      timeOfSubscription: 1700000000000,
      topic: 'test-topic',
    });
    redisClient.keys.mockResolvedValue(['kafka-relay:from-instance:subscribers:sub-takeover']);
    redisClient.get.mockResolvedValue(serializedSubscriber);
    const manager = new RedisSubscribersManager();

    await manager.takeOverSubscribers('from-instance');

    const localSubscriber = manager.get('sub-takeover');
    expect(localSubscriber.subscribe).toHaveBeenCalledWith();
  });
});
