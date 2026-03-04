import { getMessagesFromRedis } from '../../src/kafka/subscribers/messages';
import { RedisSubscribersManager } from '../../src/kafka/subscribers/redis-subscribers-manager';
import { ensureTopicConsumerRunning } from '../../src/kafka/subscribers/topic-consumers-manager';
import {
  getRedisClient,
  getRedisSubscriberClient,
} from '../../src/redis/redis-client';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/subscribers/messages', () => ({
  ...jest.requireActual('../../src/kafka/subscribers/messages'),
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
    requestedStartTimestamp: number;
    timeOfSubscription: number;
    topic: string;
    subscribe = jest.fn().mockResolvedValue(undefined);

    constructor(
      { brokers, topic }: { brokers: string[]; topic: string },
      { connectionTimeout, sasl, ssl = false }: { connectionTimeout?: number; sasl?: unknown; ssl?: boolean },
      options?: {
        debugParams?: { instanceId: string };
        requestedStartTimestamp?: number;
        takeOverParams?: { id: string; timeOfSubscription: number };
      },
    ) {
      this.id = options?.takeOverParams?.id ?? `mock-subscriber-${idCounter++}`;
      this.instanceId = options?.debugParams?.instanceId ?? 'test-instance';
      this.kafkaConfig = { brokers, connectionTimeout, sasl, ssl };
      this.requestedStartTimestamp = options?.requestedStartTimestamp ?? Date.now() - 60 * 1000;
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

  it('add with explicit timestamp sets requestedStartTimestamp', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    const manager = new RedisSubscribersManager();

    const subscriber = await manager.add(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      { connectionTimeout: undefined, sasl: undefined, ssl: false, timestamp: 12345 },
    );

    expect(subscriber.requestedStartTimestamp).toBe(12345);
  });

  it('add without timestamp defaults requestedStartTimestamp to one minute ago', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    const manager = new RedisSubscribersManager();

    const subscriber = await manager.add(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      { connectionTimeout: undefined, sasl: undefined, ssl: false },
    );

    expect(subscriber.requestedStartTimestamp).toBe(1699999940000);
    nowSpy.mockRestore();
  });

  it('addSubscriberToRedis persists requestedStartTimestamp', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    const manager = new RedisSubscribersManager();

    await manager.add(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      { connectionTimeout: undefined, sasl: undefined, ssl: false, timestamp: 555 },
    );

    const serialized = redisClient.set.mock.calls[0][1];
    expect(JSON.parse(serialized).requestedStartTimestamp).toBe(555);
  });

  it('getMessages filters by requestedStartTimestamp for local subscribers', async () => {
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
      { connectionTimeout: undefined, sasl: undefined, ssl: false, timestamp: 200 },
    );

    const messages = await manager.getMessages(subscriber.id);

    expect(mockEnsureTopicConsumerRunning).toHaveBeenCalled();
    expect(messages.map(m => Number(m.timestamp))).toEqual([200, 300]);
  });

  it('getMessages filters by requestedStartTimestamp for cross-instance subscribers', async () => {
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
      requestedStartTimestamp: 200,
      timeOfSubscription: 1700000000000,
      topic: 'test-topic',
    });
    redisClient.keys.mockResolvedValue(['kafka-relay:remote-instance:subscribers:sub-remote']);
    redisClient.get
      .mockResolvedValueOnce(serializedSubscriber)
      .mockResolvedValueOnce(serializedSubscriber);
    const manager = new RedisSubscribersManager();

    const messages = await manager.getMessages('sub-remote');

    expect(mockEnsureTopicConsumerRunning).toHaveBeenCalled();
    expect(messages.map(m => Number(m.timestamp))).toEqual([200, 300]);
  });

  it('takeOverSubscribers subscribes without timestamp and keeps requestedStartTimestamp from redis', async () => {
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
      requestedStartTimestamp: 300,
      timeOfSubscription: 1700000000000,
      topic: 'test-topic',
    });
    redisClient.keys.mockResolvedValue(['kafka-relay:from-instance:subscribers:sub-takeover']);
    redisClient.get.mockResolvedValue(serializedSubscriber);
    const manager = new RedisSubscribersManager();

    await manager.takeOverSubscribers('from-instance');

    const localSubscriber = manager.get('sub-takeover');
    expect(localSubscriber.requestedStartTimestamp).toBe(300);
    expect(localSubscriber.subscribe).toHaveBeenCalledWith();
  });

  it('recreateSubscriberFromRedis restores requestedStartTimestamp', async () => {
    const { redisClient, redisSubscriberClient } = createRedisMocks();
    mockGetRedisClient.mockReturnValue(redisClient as never);
    mockGetRedisSubscriberClient.mockReturnValue(redisSubscriberClient as never);
    redisClient.get.mockResolvedValue(JSON.stringify({
      id: 'sub-recreate',
      instanceId: 'remote-instance',
      kafkaConfig: { brokers: ['kafka:9092'], connectionTimeout: undefined, sasl: undefined, ssl: false },
      requestedStartTimestamp: 777,
      timeOfSubscription: 1700000000000,
      topic: 'test-topic',
    }));
    const manager = new RedisSubscribersManager();

    const subscriber = await (
      manager as unknown as {
        recreateSubscriberFromRedis: (
          subscriberId: string,
          relayInstanceId: string,
          allowRemote: boolean,
        ) => Promise<{ requestedStartTimestamp: number }>;
      }
    ).recreateSubscriberFromRedis('sub-recreate', 'remote-instance', true);

    expect(subscriber.requestedStartTimestamp).toBe(777);
  });
});
