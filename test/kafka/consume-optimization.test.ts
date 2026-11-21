/**
 * Phase 3: Optimization-specific tests.
 * Tests the new internals — batched scanning, paginated fetching, overlap detection.
 */

import { getMessagesFromRedis } from '../../src/kafka/subscribers/messages';
import { getRedisClient } from '../../src/redis/redis-client';
import { ConsumedMessage } from '../../src/types';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/schema-registry', () => ({ decode: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/kafka/subscribers/topic-consumers-manager', () => ({
  ensureTopicConsumerRunning: jest.fn(),
}));

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

// ---- Subscriber.getMessages(limit, offset) slicing tests ----

describe('Subscriber.getMessages(limit, offset)', () => {
  const makeSubscriber = () => {
    const { Subscriber } = require('../../src/kafka/subscribers/subscriber') as typeof import('../../src/kafka/subscribers/subscriber');
    mockGetRedisClient.mockReturnValue({ subscribe: jest.fn() } as never);
    const sub = new Subscriber(
      { brokers: ['kafka:9092'], topic: 'test-topic' },
      {},
      undefined,
      undefined,
      false,
    );
    const msgs: ConsumedMessage[] = (sub as unknown as { messages: ConsumedMessage[] }).messages;
    const pushMsg = (value: string) => msgs.push({ timestamp: String(msgs.length), value });
    return { pushMsg, sub };
  };

  it('returns last N messages from tail (offset=0)', () => {
    const { pushMsg, sub } = makeSubscriber();
    for (let i = 1; i <= 10; i++) {
      pushMsg(`msg${i}`);
    }
    const result = sub.getMessages(3, 0) as ConsumedMessage[];
    expect(result).toHaveLength(3);
    expect(result.map(m => m.value)).toEqual(['msg8', 'msg9', 'msg10']);
  });

  it('returns messages at mid-array batch (offset=3)', () => {
    const { pushMsg, sub } = makeSubscriber();
    for (let i = 1; i <= 10; i++) {
      pushMsg(`msg${i}`);
    }
    // offset=3 skips last 3 (msg8,msg9,msg10), limit=3 returns the 3 before them
    const result = sub.getMessages(3, 3) as ConsumedMessage[];
    expect(result).toHaveLength(3);
    expect(result.map(m => m.value)).toEqual(['msg5', 'msg6', 'msg7']);
  });

  it('returns empty array when offset is beyond array length', () => {
    const { pushMsg, sub } = makeSubscriber();
    for (let i = 1; i <= 3; i++) {
      pushMsg(`msg${i}`);
    }
    const result = sub.getMessages(5, 10) as ConsumedMessage[];
    expect(result).toEqual([]);
  });

  it('returns all messages when limit is larger than array', () => {
    const { pushMsg, sub } = makeSubscriber();
    pushMsg('a');
    pushMsg('b');
    const result = sub.getMessages(100, 0) as ConsumedMessage[];
    expect(result).toHaveLength(2);
  });

  it('returns empty array when message store is empty', () => {
    const { sub } = makeSubscriber();
    const result = sub.getMessages(5, 0) as ConsumedMessage[];
    expect(result).toEqual([]);
  });
});

// ---- getMessagesFromRedis(topic, limit, offset) ZRANGE tests ----

describe('getMessagesFromRedis(topic, limit, offset)', () => {
  const topic = 'test-topic';
  // toTopicMessagesKey uses `kafka-relay:topics:<topic>:messages` (no instance ID)
  const messagesKey = 'kafka-relay:topics:test-topic:messages';

  let mockZRange: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockZRange = jest.fn();
    mockGetRedisClient.mockReturnValue({ zRange: mockZRange } as never);
  });

  it('passes correct negative indices for limit=5 offset=0 (tail fetch)', async () => {
    mockZRange.mockResolvedValue([]);
    await getMessagesFromRedis(topic, 5, 0);
    expect(mockZRange).toHaveBeenCalledWith(messagesKey, -5, -1);
  });

  it('passes correct negative indices for limit=5 offset=3 (batch pagination)', async () => {
    mockZRange.mockResolvedValue([]);
    await getMessagesFromRedis(topic, 5, 3);
    expect(mockZRange).toHaveBeenCalledWith(messagesKey, -8, -4);
  });

  it('passes correct negative indices for limit=100 offset=100', async () => {
    mockZRange.mockResolvedValue([]);
    await getMessagesFromRedis(topic, 100, 100);
    expect(mockZRange).toHaveBeenCalledWith(messagesKey, -200, -101);
  });

  it('parses serialized messages and stringifies non-string values', async () => {
    const msg = { headers: {}, key: null, timestamp: '100', value: { nested: 'obj' } };
    mockZRange.mockResolvedValue([JSON.stringify(msg)]);
    const result = await getMessagesFromRedis(topic, 1, 0);
    expect(result[0].value).toBe(JSON.stringify({ nested: 'obj' }));
  });

  it('returns empty array when zRange returns empty', async () => {
    mockZRange.mockResolvedValue([]);
    const result = await getMessagesFromRedis(topic, 5, 0);
    expect(result).toEqual([]);
  });
});

// ---- scanForMatches batching/overlap/termination tests ----
// Uses CONSUME_BATCH_SIZE=2 via env + jest.resetModules() to exercise multi-batch paths

describe('scanForMatches via consume() with BATCH_SIZE=2', () => {
  const BATCH_SIZE = 2;
  let consume: (typeof import('../../src/kafka/consume'))['consume'];
  let mockGetMessages: jest.Mock;

  beforeEach(() => {
    process.env.CONSUME_BATCH_SIZE = String(BATCH_SIZE);
    jest.resetModules();

    jest.mock('../../src/kafka/subscribers', () => ({
      getMessages: jest.fn(),
    }));
    jest.mock('../../src/kafka/subscribers/subscribers-manager-factory', () => ({
      subscriptionsManager: { stopDeletingExpiredSubscribers: jest.fn() },
    }));

    const subscribers = require('../../src/kafka/subscribers') as typeof import('../../src/kafka/subscribers');
    mockGetMessages = subscribers.getMessages as jest.Mock;

    const consumeModule = require('../../src/kafka/consume') as typeof import('../../src/kafka/consume');
    consume = consumeModule.consume;
  });

  afterEach(() => {
    delete process.env.CONSUME_BATCH_SIZE;
    jest.resetModules();
    jest.useRealTimers();
  });

  const makeMsg = (value: string): ConsumedMessage => ({
    headers: {},
    timestamp: '1000',
    value,
  });

  it('unfiltered empty store: calls getMessages exactly once and does not fall through to filtered loop', async () => {
    jest.useFakeTimers();
    mockGetMessages.mockResolvedValue([]);

    const promise = consume({ id: 'sub1' }, { timeout: 1 });
    const assertion = expect(promise).rejects.toMatchObject({ statusCode: 404 });
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;

    // Each polling iteration should call getMessages exactly once (unfiltered path),
    // not twice (once for unfiltered + once for filtered fallthrough)
    const calls = mockGetMessages.mock.calls;
    expect(calls.every(([, limit, offset]) => limit === 1 && offset === 0)).toBe(true);
  });

  it('unfiltered: calls getMessages once with maxMessages=1 and returns single message', async () => {
    mockGetMessages.mockResolvedValue([makeMsg('only')]);

    const result = await consume({ id: 'sub1' }, { text: 'true' });

    expect(mockGetMessages).toHaveBeenCalledTimes(1);
    expect(mockGetMessages).toHaveBeenCalledWith('sub1', 1, 0);
    expect(result[0].value).toBe('only');
  });

  it('unfiltered multiple=3: calls getMessages once with limit=3', async () => {
    mockGetMessages.mockImplementation((_id: string, limit: number) =>
      Promise.resolve(Array.from({ length: limit }, (_, i) => makeMsg(`msg${i + 1}`))),
    );

    const result = await consume({ id: 'sub1' }, { multiple: 3, text: 'true' });

    expect(mockGetMessages).toHaveBeenCalledWith('sub1', 3, 0);
    expect(result).toHaveLength(3);
  });

  it('filtered scan across multiple batches returns matches in chronological order', async () => {
    // Store: [matchA, no1, matchB, no2, matchC, no3] (index 0=oldest, 5=newest)
    // BATCH_SIZE=2: offset=0 → last 2 [matchC, no3], offset=2 → [matchB, no2], offset=4 → [matchA, no1]
    const store = [
      makeMsg('match-A'), makeMsg('no1'),
      makeMsg('match-B'), makeMsg('no2'),
      makeMsg('match-C'), makeMsg('no3'),
    ];
    mockGetMessages.mockImplementation((_id: string, limit: number, offset: number) => {
      const end = store.length - offset;
      const start = Math.max(0, end - limit);
      if (end <= 0) {
        return Promise.resolve([]);
      }
      return Promise.resolve(store.slice(start, end));
    });

    const result = await consume({ id: 'sub1' }, { multiple: 3, regexFilter: '^match-', text: 'true' });

    expect(result).toHaveLength(3);
    // Results returned in chronological order (oldest first)
    expect(result[0].value).toBe('match-A');
    expect(result[1].value).toBe('match-B');
    expect(result[2].value).toBe('match-C');
  });

  it('stops scanning after partial batch, then finds match — only 2 getMessages calls', async () => {
    // Store: [findMe, noMatch1, noMatch2] (3 total, BATCH_SIZE=2)
    // Call 1: offset=0 → last 2 = [noMatch1, noMatch2] (full batch, no matches)
    // Call 2: offset=2 → [findMe] (partial batch, matches → stop)
    const findMe = makeMsg('find-me');
    const noMatch1 = makeMsg('nothing-1');
    const noMatch2 = makeMsg('nothing-2');
    const store = [findMe, noMatch1, noMatch2];
    let callCount = 0;

    mockGetMessages.mockImplementation((_id: string, limit: number, offset: number) => {
      callCount++;
      const end = store.length - offset;
      const start = Math.max(0, end - limit);
      if (end <= 0) {
        return Promise.resolve([]);
      }
      return Promise.resolve(store.slice(start, end));
    });

    const result = await consume({ id: 'sub1' }, { multiple: 1, regexFilter: '^find-me$', text: 'true' });

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('find-me');
    expect(callCount).toBe(2);
  });

  it('overlap detection: skips messages that appear in both consecutive batches', async () => {
    // Simulate concurrent write shifting batch boundary:
    // Call 1 (offset=0): [dupMsg, noMatch] — full batch, no matches
    // Call 2 (offset=2): [findMe, dupMsg] — dupMsg is overlap; findMe should match
    const findMe = makeMsg('find-me');
    const dupMsg = makeMsg('dup-no-match');
    const noMatch = makeMsg('no-match');

    let callCount = 0;
    mockGetMessages.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([dupMsg, noMatch]);
      }
      if (callCount === 2) {
        return Promise.resolve([findMe, dupMsg]); // dupMsg duplicated from batch 1
      }
      return Promise.resolve([]);
    });

    const result = await consume({ id: 'sub1' }, { regexFilter: '^find-me$', text: 'true' });

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('find-me');
  });

  it('returns 404 when no matches found after exhausting all messages', async () => {
    jest.useFakeTimers();
    // Single message (< BATCH_SIZE) → scan terminates, no match, retry → timeout
    mockGetMessages.mockImplementation((_id: string, _limit: number, offset: number) => {
      if (offset === 0) {
        return Promise.resolve([makeMsg('no-match')]);
      }
      return Promise.resolve([]);
    });

    const promise = consume({ id: 'sub1' }, { regexFilter: '^xyz$', timeout: 1 });
    const assertion = expect(promise).rejects.toMatchObject({ statusCode: 404 });
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});
