import {
  TOPIC_CONSUMER_DISCONNECT_TIMEOUT_MS,
  TOPIC_CONSUMER_UNHEALTHY_ASSIGNMENT_THRESHOLD,
  TOPIC_LEADER_LOCK_FENCE_MARGIN_MS,
  TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS,
  TOPIC_LEADER_LOCK_TTL_SECONDS,
  TOPIC_LEADER_READY_POLL_INTERVAL_MS,
  TOPIC_LEADER_READY_WAIT_TIMEOUT_MS,
  TOPIC_LEADERSHIP_RELEASE_TIMEOUT_MS,
} from '../../src/kafka/subscribers/constants';
import { ensureTopicConsumerRunning } from '../../src/kafka/subscribers/topic-consumers-manager';
import { getRedisClient } from '../../src/redis/redis-client';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/schema-registry', () => ({ decode: jest.fn().mockResolvedValue(undefined) }));

const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockIsTopicConsumerCaptureReady = jest.fn().mockReturnValue(true);
const mockReseekToLatestMessages = jest.fn().mockResolvedValue(undefined);
const mockSubscribeAsTopicConsumer = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/kafka/subscribers/redis-subscriber', () => ({
  RedisSubscriber: jest.fn().mockImplementation(() => ({
    consumer: { disconnect: mockDisconnect },
    isTopicConsumerCaptureReady: mockIsTopicConsumerCaptureReady,
    reseekToLatestMessages: mockReseekToLatestMessages,
    subscribeAsTopicConsumer: mockSubscribeAsTopicConsumer,
  })),
}));

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;
const subscribeOptions = { connectionTimeout: undefined, sasl: undefined, ssl: false as const };

let topicCounter = 0;
const nextTopic = () => `test-topic-${topicCounter++}`;
const expectTestOwnershipToken = (ownershipToken: string | null) => {
  expect(ownershipToken).toEqual(expect.stringMatching(/^test-instance:\d+$/));
};

const createRedisState = () => {
  let leader: string | null = null;
  let leaderExpiresAt = Number.POSITIVE_INFINITY;
  let readyLeader: string | null = null;
  let readyLeaderExpiresAt = Number.POSITIVE_INFINITY;

  const expireKeys = () => {
    if (leader && Date.now() >= leaderExpiresAt) {
      leader = null;
    }
    if (readyLeader && Date.now() >= readyLeaderExpiresAt) {
      readyLeader = null;
    }
  };

  const client = {
    eval: jest.fn(async (
      script: string,
      options: { arguments: string[]; keys: string[] },
    ) => {
      expireKeys();
      const owner = options.arguments[0];

      if (options.keys.length === 1) {
        if (readyLeader === owner) {
          readyLeader = null;
        }
        return 1;
      }

      const ttlMilliseconds = Number(options.arguments[1]) * 1000;

      if (script.includes('redis.call(\'EXPIRE\', KEYS[1]')) {
        if (leader !== owner) {
          return 0;
        }
        leaderExpiresAt = Date.now() + ttlMilliseconds;
        if (options.arguments[2] === '1') {
          readyLeader = owner;
          readyLeaderExpiresAt = Date.now() + ttlMilliseconds;
        } else if (readyLeader === owner) {
          readyLeader = null;
        }
        return 1;
      }

      if (script.includes('redis.call(\'SET\', KEYS[2]')) {
        if (leader !== owner) {
          return 0;
        }
        readyLeader = owner;
        readyLeaderExpiresAt = Date.now() + ttlMilliseconds;
        return 1;
      }

      if (leader === owner) {
        leader = null;
      }
      if (readyLeader === owner) {
        readyLeader = null;
      }
      return 1;
    }),
    get: jest.fn(async (key: string) => {
      expireKeys();
      return key.endsWith(':leader') ? leader : null;
    }),
    mGet: jest.fn(async () => {
      expireKeys();
      return [leader, readyLeader];
    }),
    set: jest.fn(async (key: string, owner: string) => {
      expireKeys();
      if (!key.endsWith(':leader') || leader !== null) {
        return null;
      }
      leader = owner;
      leaderExpiresAt = Date.now() + TOPIC_LEADER_LOCK_TTL_SECONDS * 1000;
      return 'OK';
    }),
    zCard: jest.fn().mockResolvedValue(1),
  };

  return {
    client,
    getLeader: () => {
      expireKeys();
      return leader;
    },
    getReadyLeader: () => {
      expireKeys();
      return readyLeader;
    },
    setLeader: (owner: string | null, ttlMilliseconds = Number.POSITIVE_INFINITY) => {
      leader = owner;
      leaderExpiresAt = Date.now() + ttlMilliseconds;
    },
    setReadyLeader: (owner: string | null, ttlMilliseconds = Number.POSITIVE_INFINITY) => {
      readyLeader = owner;
      readyLeaderExpiresAt = Date.now() + ttlMilliseconds;
    },
  };
};

describe('ensureTopicConsumerRunning', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
    mockIsTopicConsumerCaptureReady.mockReturnValue(true);
    mockReseekToLatestMessages.mockResolvedValue(undefined);
    mockSubscribeAsTopicConsumer.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('publishes readiness only after Kafka startup succeeds', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolveStartup!: () => void;
    mockGetRedisClient.mockReturnValue(redis.client as never);
    mockSubscribeAsTopicConsumer.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveStartup = resolve;
    }));

    const starting = ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    await jest.advanceTimersByTimeAsync(0);

    const ownershipToken = redis.getLeader();
    expectTestOwnershipToken(ownershipToken);
    expect(redis.getReadyLeader()).toBeNull();

    resolveStartup();
    await starting;

    expect(redis.getReadyLeader()).toBe(ownershipToken);
    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledWith();
  });

  it('serializes concurrent cold starts for the same topic', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolveLeadershipState!: (state: Array<string | null>) => void;
    mockGetRedisClient.mockReturnValue(redis.client as never);
    redis.client.mGet.mockReturnValueOnce(new Promise((resolve) => {
      resolveLeadershipState = resolve;
    }));

    const first = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    );
    const second = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    );

    expect(second).toBe(first);
    await jest.advanceTimersByTimeAsync(0);
    expect(redis.client.mGet).toHaveBeenCalledTimes(1);
    expect(redis.client.set).not.toHaveBeenCalled();

    resolveLeadershipState([null, null]);
    await Promise.all([first, second]);

    expect(redis.client.set).toHaveBeenCalledTimes(1);
    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('cleans up and retries after rejected Kafka startup', async () => {
    const redis = createRedisState();
    const startupError = new Error('Kafka startup rejected');
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);
    mockSubscribeAsTopicConsumer.mockRejectedValueOnce(startupError);

    await expect(
      ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions),
    ).rejects.toThrow(startupError);

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBeNull();
    expect(redis.getReadyLeader()).toBeNull();
    const evalCallsAfterCleanup = redis.client.eval.mock.calls.length;
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS * 2);
    expect(redis.client.eval).toHaveBeenCalledTimes(evalCallsAfterCleanup);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(2);
    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('bounds a stalled Kafka startup and permits a later generation to retry', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);
    mockSubscribeAsTopicConsumer.mockReturnValueOnce(new Promise(() => undefined));

    const starting = expect(ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    )).rejects.toThrow(`Timed out starting topic consumer for ${topic}`);

    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_READY_WAIT_TIMEOUT_MS);
    await starting;

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBeNull();
    expect(redis.getReadyLeader()).toBeNull();

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(2);
    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('does not start Kafka after a stale leadership acquisition response', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    const acquisitionResponseDelay = TOPIC_LEADER_LOCK_TTL_SECONDS * 1000
      - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS
      + 1;
    const setImplementation = redis.client.set.getMockImplementation();
    let acquisitionCalls = 0;
    mockGetRedisClient.mockReturnValue(redis.client as never);
    redis.client.set.mockImplementation((...args) => {
      acquisitionCalls += 1;
      if (acquisitionCalls > 1) {
        return Promise.resolve(null);
      }

      const response = Promise.resolve(setImplementation!(...args));
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          void response.then(resolve, reject);
        }, acquisitionResponseDelay);
      });
    });

    const starting = expect(ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    )).rejects.toThrow(`Timed out waiting for a ready topic consumer for ${topic}`);

    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_READY_WAIT_TIMEOUT_MS);
    await starting;

    expect(mockSubscribeAsTopicConsumer).not.toHaveBeenCalled();
    expect(redis.getLeader()).toBeNull();
    expect(redis.getReadyLeader()).toBeNull();
  });

  it('rejects a late readiness response after the consumer was fenced', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    const readyResponseDelay = TOPIC_LEADER_LOCK_TTL_SECONDS * 1000
      - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS
      + 500;
    const evalImplementation = redis.client.eval.getMockImplementation();
    mockGetRedisClient.mockReturnValue(redis.client as never);
    redis.client.eval.mockImplementation((script, options) => {
      if (script.includes('redis.call(\'EXPIRE\', KEYS[1]')) {
        return new Promise(() => undefined);
      }
      if (!script.includes('redis.call(\'SET\', KEYS[2]')) {
        return evalImplementation!(script, options);
      }

      const response = Promise.resolve(evalImplementation!(script, options));
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          void response.then(resolve, reject);
        }, readyResponseDelay);
      });
    });

    const starting = expect(ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    )).rejects.toThrow(`Lost topic leadership while starting consumer for ${topic}`);

    await jest.advanceTimersByTimeAsync(readyResponseDelay);
    await starting;

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBeNull();
    expect(redis.getReadyLeader()).toBeNull();
  });

  it('disconnects a completed startup that loses ownership before ready publication', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolveStartup!: () => void;
    mockGetRedisClient.mockReturnValue(redis.client as never);
    mockSubscribeAsTopicConsumer.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveStartup = resolve;
    }));

    const starting = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    );
    await jest.advanceTimersByTimeAsync(0);
    redis.setLeader('other-instance:successor');
    redis.setReadyLeader('other-instance:successor');

    resolveStartup();
    await expect(starting).rejects.toThrow(
      `Lost topic leadership while starting consumer for ${topic}`,
    );

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBe('other-instance:successor');
    expect(redis.getReadyLeader()).toBe('other-instance:successor');
  });

  it('replaces owned readiness that has no local consumer', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolveStartup!: () => void;
    redis.setLeader('test-instance:stale');
    redis.setReadyLeader('test-instance:stale');
    mockGetRedisClient.mockReturnValue(redis.client as never);
    mockSubscribeAsTopicConsumer.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveStartup = resolve;
    }));

    const starting = ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    await jest.advanceTimersByTimeAsync(0);

    expect(redis.getReadyLeader()).toBeNull();
    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);

    resolveStartup();
    await starting;

    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('waits until another relay leader is capture-ready', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolved = false;
    redis.setLeader('other-instance:1');
    mockGetRedisClient.mockReturnValue(redis.client as never);

    const waiting = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    ).then(() => {
      resolved = true;
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(resolved).toBe(false);
    expect(mockSubscribeAsTopicConsumer).not.toHaveBeenCalled();

    redis.setReadyLeader('other-instance:1');
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_READY_POLL_INTERVAL_MS);
    await waiting;

    expect(resolved).toBe(true);
    expect(mockSubscribeAsTopicConsumer).not.toHaveBeenCalled();
  });

  it('fails within a bounded interval when the leader never becomes ready', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    redis.setLeader('other-instance:1');
    mockGetRedisClient.mockReturnValue(redis.client as never);

    const waiting = expect(ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    )).rejects.toThrow(`Timed out waiting for a ready topic consumer for ${topic}`);

    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_READY_WAIT_TIMEOUT_MS);
    await waiting;

    expect(mockSubscribeAsTopicConsumer).not.toHaveBeenCalled();
  });

  it('takes over after an unready leader lease expires', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    redis.setLeader('dead-instance', TOPIC_LEADER_LOCK_TTL_SECONDS * 1000);
    mockGetRedisClient.mockReturnValue(redis.client as never);

    const waiting = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    );
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_TTL_SECONDS * 1000);
    await waiting;

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);
    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('disconnects a stale local consumer after losing leadership', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    redis.setLeader('other-instance:1');
    redis.setReadyLeader('other-instance:1');

    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBe('other-instance:1');
    expect(redis.getReadyLeader()).toBe('other-instance:1');
  });

  it('fences and restarts the local consumer when leadership renewal stalls', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    const evalImplementation = redis.client.eval.getMockImplementation();
    redis.client.eval.mockImplementation((script, options) => {
      if (script.includes('redis.call(\'EXPIRE\', KEYS[1]')) {
        return new Promise(() => undefined);
      }
      return evalImplementation!(script, options);
    });

    await jest.advanceTimersByTimeAsync(
      TOPIC_LEADER_LOCK_TTL_SECONDS * 1000 - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS,
    );

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBeNull();
    expect(redis.getReadyLeader()).toBeNull();

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(2);
    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('keeps the fence ahead of a delayed successful renewal response', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    const renewalResponseDelay = TOPIC_LEADER_LOCK_FENCE_MARGIN_MS + 500;
    let disconnectedAt: number | undefined;
    mockGetRedisClient.mockReturnValue(redis.client as never);
    mockDisconnect.mockImplementationOnce(async () => {
      disconnectedAt = Date.now();
    });

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    const startedAt = Date.now();
    const evalImplementation = redis.client.eval.getMockImplementation();
    let renewalCalls = 0;
    redis.client.eval.mockImplementation((script, options) => {
      if (!script.includes('redis.call(\'EXPIRE\', KEYS[1]')) {
        return evalImplementation!(script, options);
      }

      renewalCalls += 1;
      if (renewalCalls > 1) {
        return new Promise(() => undefined);
      }

      const response = Promise.resolve(evalImplementation!(script, options));
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          void response.then(resolve, reject);
        }, renewalResponseDelay);
      });
    });

    await jest.advanceTimersByTimeAsync(
      TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS + renewalResponseDelay,
    );
    const leaseExpiry = startedAt
      + TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS
      + TOPIC_LEADER_LOCK_TTL_SECONDS * 1000;
    const conservativeFenceDeadline = leaseExpiry - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS;
    await jest.advanceTimersByTimeAsync(conservativeFenceDeadline - Date.now());

    expect(disconnectedAt).toBe(conservativeFenceDeadline);
    expect(disconnectedAt).toBeLessThan(leaseExpiry);
  });

  it('fences locally when renewal and Redis cleanup reject', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    const renewalError = new Error('Redis unavailable');
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    const initialOwnershipToken = redis.getLeader();
    expectTestOwnershipToken(initialOwnershipToken);
    const evalImplementation = redis.client.eval.getMockImplementation();
    redis.client.eval.mockRejectedValue(renewalError);

    await jest.advanceTimersByTimeAsync(
      TOPIC_LEADER_LOCK_TTL_SECONDS * 1000 - TOPIC_LEADER_LOCK_FENCE_MARGIN_MS,
    );

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBe(initialOwnershipToken);
    expect(redis.getReadyLeader()).toBe(initialOwnershipToken);

    redis.client.eval.mockImplementation(evalImplementation!);
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_FENCE_MARGIN_MS);
    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(2);
    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getLeader()).not.toBe(initialOwnershipToken);
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('withdraws readiness and disconnects after persistent assignment loss', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    mockIsTopicConsumerCaptureReady.mockReturnValue(false);

    await jest.advanceTimersByTimeAsync(
      TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS * TOPIC_CONSUMER_UNHEALTHY_ASSIGNMENT_THRESHOLD,
    );

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(redis.getLeader()).toBeNull();
    expect(redis.getReadyLeader()).toBeNull();
  });

  it('withdraws readiness atomically with renewal on the first unhealthy check', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    const evalImplementation = redis.client.eval.getMockImplementation();
    redis.client.eval.mockImplementation((script, options) => {
      if (options.keys.length === 1) {
        return Promise.reject(new Error('standalone readiness cleanup unavailable'));
      }
      return evalImplementation!(script, options);
    });
    mockIsTopicConsumerCaptureReady.mockReturnValue(false);

    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);

    expect(redis.getLeader()).not.toBeNull();
    expect(redis.getReadyLeader()).toBeNull();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('waits for an in-flight stop before starting a replacement generation', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolveDisconnect!: () => void;
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    const initialOwnershipToken = redis.getLeader();
    mockDisconnect.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    }));
    mockIsTopicConsumerCaptureReady.mockReturnValue(false);

    await jest.advanceTimersByTimeAsync(
      TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS * TOPIC_CONSUMER_UNHEALTHY_ASSIGNMENT_THRESHOLD,
    );
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    let restarted = false;
    const restarting = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    ).then(() => {
      restarted = true;
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(restarted).toBe(false);
    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);

    mockIsTopicConsumerCaptureReady.mockReturnValue(true);
    resolveDisconnect();
    await restarting;

    expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(2);
    expectTestOwnershipToken(redis.getLeader());
    expect(redis.getLeader()).not.toBe(initialOwnershipToken);
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('fails fast when Kafka disconnect never settles', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    const processExitError = new Error('process exit requested');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw processExitError;
    });
    mockGetRedisClient.mockReturnValue(redis.client as never);

    try {
      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
      mockDisconnect.mockReturnValueOnce(new Promise(() => undefined));
      mockIsTopicConsumerCaptureReady.mockReturnValue(false);
      await jest.advanceTimersByTimeAsync(
        TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS * TOPIC_CONSUMER_UNHEALTHY_ASSIGNMENT_THRESHOLD,
      );

      const checking = expect(ensureTopicConsumerRunning(
        { brokers: ['kafka:9092'], topic },
        subscribeOptions,
      )).rejects.toBe(processExitError);
      await jest.advanceTimersByTimeAsync(TOPIC_CONSUMER_DISCONNECT_TIMEOUT_MS);
      await checking;

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockSubscribeAsTopicConsumer).toHaveBeenCalledTimes(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('bounds stalled Redis cleanup after Kafka disconnect is confirmed', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    const evalImplementation = redis.client.eval.getMockImplementation();
    redis.client.eval.mockImplementation((script, options) => {
      if (script.includes('local released = 0')) {
        return new Promise(() => undefined);
      }
      return evalImplementation!(script, options);
    });
    redis.setLeader('other-instance:successor');
    redis.setReadyLeader('other-instance:successor');
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);

    let resolved = false;
    const checking = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    ).then(() => {
      resolved = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(TOPIC_LEADERSHIP_RELEASE_TIMEOUT_MS);
    await checking;

    expect(resolved).toBe(true);
    expect(redis.getLeader()).toBe('other-instance:successor');
    expect(redis.getReadyLeader()).toBe('other-instance:successor');
  });

  it('waits for transient local assignment recovery without stopping the consumer', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolved = false;
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    mockIsTopicConsumerCaptureReady.mockReturnValue(false);
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS);

    expect(redis.getReadyLeader()).toBeNull();
    expect(mockDisconnect).not.toHaveBeenCalled();

    const waiting = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    ).then(() => {
      resolved = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    mockIsTopicConsumerCaptureReady.mockReturnValue(true);
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_READY_POLL_INTERVAL_MS);
    await waiting;

    expect(resolved).toBe(true);
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
  });

  it('withdraws stale local readiness before waiting for assignment recovery', async () => {
    const redis = createRedisState();
    const topic = nextTopic();
    let resolved = false;
    mockGetRedisClient.mockReturnValue(redis.client as never);

    await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
    mockIsTopicConsumerCaptureReady.mockReturnValue(false);

    const waiting = ensureTopicConsumerRunning(
      { brokers: ['kafka:9092'], topic },
      subscribeOptions,
    ).then(() => {
      resolved = true;
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(resolved).toBe(false);
    expect(redis.getReadyLeader()).toBeNull();
    expect(mockDisconnect).not.toHaveBeenCalled();

    mockIsTopicConsumerCaptureReady.mockReturnValue(true);
    await jest.advanceTimersByTimeAsync(TOPIC_LEADER_READY_POLL_INTERVAL_MS);
    await waiting;

    expect(resolved).toBe(true);
    expect(redis.getReadyLeader()).toBe(redis.getLeader());
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  describe('when consumer is already running', () => {
    const seedRunningConsumer = async (topic: string) => {
      const redis = createRedisState();
      mockGetRedisClient.mockReturnValue(redis.client as never);
      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);
      jest.clearAllMocks();
      return redis;
    };

    it('re-seeks when the topic message buffer is empty', async () => {
      const topic = nextTopic();
      const redis = await seedRunningConsumer(topic);
      redis.client.zCard.mockResolvedValue(0);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(redis.client.zCard).toHaveBeenCalledWith(`kafka-relay:topics:v3:${topic}:messages`);
      expect(mockReseekToLatestMessages).toHaveBeenCalledTimes(1);
    });

    it('does not re-seek when the topic message buffer is populated', async () => {
      const topic = nextTopic();
      const redis = await seedRunningConsumer(topic);
      redis.client.zCard.mockResolvedValue(5);

      await ensureTopicConsumerRunning({ brokers: ['kafka:9092'], topic }, subscribeOptions);

      expect(mockReseekToLatestMessages).not.toHaveBeenCalled();
    });
  });
});
