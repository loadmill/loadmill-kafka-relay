import { ConsumedMessage } from '../../src/types';

const mockZRange = jest.fn();
jest.mock('../../src/redis/redis-client', () => ({
  getRedisClient: () => ({ zRange: mockZRange }),
}));

const makeMessage = (id: number, value: string): ConsumedMessage => ({
  timestamp: String(id),
  value,
});

const serialize = (msg: ConsumedMessage): string => JSON.stringify(msg);

describe('getMessagesFromRedis', () => {
  let getMessagesFromRedis: typeof import('../../src/kafka/subscribers/redis-messages').getMessagesFromRedis;

  beforeAll(() => {
    process.env.REDIS_SCAN_BATCH_SIZE = '2';
    jest.resetModules();
    ({ getMessagesFromRedis } = require('../../src/kafka/subscribers/redis-messages'));
  });

  afterAll(() => {
    delete process.env.REDIS_SCAN_BATCH_SIZE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Reproduces: overlap detection early-return skips valid matches in the same batch.
   *
   * Setup (batch size = 2):
   *   Sorted set has 4 messages: msg_1, msg_2, msg_3, msg_4
   *   msg_2 and msg_4 match the filter. We request multiple=2.
   *
   * Batch 1 (offset=0): ZRANGE key -2 -1 → [msg_3, msg_4]
   *   Iterates right-to-left: msg_4 matches → matches=[msg_4]. msg_3 no match.
   *   previousBatch = { msg_3, msg_4 }, offset = 2
   *
   * Between batches: msg_5 is appended (concurrent Kafka write).
   * Sorted set now has 5 elements → window shifts by 1.
   *
   * Batch 2 (offset=2): ZRANGE key -4 -3 on 5 elements → [msg_2, msg_3]
   *   Iterates right-to-left:
   *     msg_3 → in previousBatch → BUG: `return` exits the function!
   *     msg_2 (matches!) is never checked.
   *
   * Batch 3 (offset=4): ZRANGE key -6 -5 on 5 elements → [msg_1]
   *   msg_1 doesn't match.
   *   1 < batchSize → end of messages → break.
   *
   * Actual result: [msg_4] (1 match). Expected: [msg_2, msg_4] (2 matches).
   */
  it('should find matches beyond overlap zone when messages are added between batches', async () => {
    const msg1 = makeMessage(1, 'unrelated');
    const msg2 = makeMessage(2, 'order-ABC-first'); // matches
    const msg3 = makeMessage(3, 'unrelated');
    const msg4 = makeMessage(4, 'order-ABC-second'); // matches

    // Batch 1: ZRANGE key -2 -1 (4 elements) → [msg_3, msg_4]
    mockZRange.mockResolvedValueOnce([serialize(msg3), serialize(msg4)]);

    // Batch 2: ZRANGE key -4 -3 (5 elements after msg_5 appended) → [msg_2, msg_3]
    // msg_3 overlaps with batch 1, msg_2 is unseen and matches the filter
    mockZRange.mockResolvedValueOnce([serialize(msg2), serialize(msg3)]);

    // Batch 3: ZRANGE key -6 -5 (5 elements) → [msg_1]
    mockZRange.mockResolvedValueOnce([serialize(msg1)]);

    const result = await getMessagesFromRedis('orders', {
      multiple: 2,
      valueRegex: /order-ABC/,
    });

    expect(result).toEqual([
      expect.objectContaining({ timestamp: '2', value: 'order-ABC-first' }),
      expect.objectContaining({ timestamp: '4', value: 'order-ABC-second' }),
    ]);
  });
});
