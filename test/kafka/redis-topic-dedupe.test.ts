import {
  appendTopicMessageWithDedupe,
  compareOffsetStrings,
  isIncomingOffsetNewer,
} from '../../src/kafka/subscribers/redis-topic-dedupe';

describe('redis topic dedupe offset comparisons', () => {
  describe('compareOffsetStrings', () => {
    it('returns 0 for equal offsets', () => {
      expect(compareOffsetStrings('29123', '29123')).toBe(0);
    });

    it('returns positive number when left is greater', () => {
      expect(compareOffsetStrings('29124', '29123')).toBeGreaterThan(0);
    });

    it('returns negative number when left is smaller', () => {
      expect(compareOffsetStrings('29122', '29123')).toBeLessThan(0);
    });

    it('compares large integer-strings safely', () => {
      const current = '18446744073709551614';
      const incoming = '18446744073709551615';
      expect(compareOffsetStrings(incoming, current)).toBeGreaterThan(0);
    });
  });

  describe('isIncomingOffsetNewer', () => {
    it('accepts first offset when no watermark exists', () => {
      expect(isIncomingOffsetNewer(null, '1')).toBe(true);
    });

    it('rejects same offset as duplicate', () => {
      expect(isIncomingOffsetNewer('120', '120')).toBe(false);
    });

    it('rejects lower offset as duplicate', () => {
      expect(isIncomingOffsetNewer('120', '119')).toBe(false);
    });

    it('accepts higher offset', () => {
      expect(isIncomingOffsetNewer('120', '121')).toBe(true);
    });
  });

  describe('appendTopicMessageWithDedupe', () => {
    const baseParams = {
      maxMessages: 5000,
      messagesKey: 'kafka-relay:topics:test-topic:messages',
      offset: '29123',
      partition: 0,
      serializedMessage: '{"offset":"29123","partition":0}',
      ttlSeconds: 600,
      watermarkKey: 'kafka-relay:topics:test-topic:partition-offset-watermarks',
    };

    type MockTxn = {
      exec: jest.Mock<Promise<unknown[] | null>, []>;
      expire: jest.Mock<MockTxn, [string, number]>;
      hSet: jest.Mock<MockTxn, [string, string, string]>;
      lTrim: jest.Mock<MockTxn, [string, number, number]>;
      rPush: jest.Mock<MockTxn, [string, string]>;
    };

    type MockIsolatedClient = {
      hGet: jest.Mock<Promise<string | null>, [string, string]>;
      multi: jest.Mock<MockTxn, []>;
      unwatch?: jest.Mock<Promise<void>, []>;
      watch: jest.Mock<Promise<void>, [string]>;
    };

    const createTxn = (execResult: unknown[] | null): MockTxn => {
      const txn = {
        exec: jest.fn<Promise<unknown[] | null>, []>().mockResolvedValue(execResult),
        expire: jest.fn<MockTxn, [string, number]>(),
        hSet: jest.fn<MockTxn, [string, string, string]>(),
        lTrim: jest.fn<MockTxn, [string, number, number]>(),
        rPush: jest.fn<MockTxn, [string, string]>(),
      };
      txn.rPush.mockReturnValue(txn);
      txn.lTrim.mockReturnValue(txn);
      txn.hSet.mockReturnValue(txn);
      txn.expire.mockReturnValue(txn);
      return txn;
    };

    const createRedisClient = (clients: MockIsolatedClient[]) => {
      const executeIsolated = jest.fn(async (
        cb: (isolatedClient: MockIsolatedClient) => Promise<unknown>,
      ) => {
        const isolatedClient = clients.shift();
        if (!isolatedClient) {
          throw new Error('No mock isolated client left');
        }
        return await cb(isolatedClient);
      });
      return {
        executeIsolated,
      };
    };

    it('returns duplicate and skips transaction when offset is not newer', async () => {
      const watch = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
      const hGet = jest.fn<Promise<string | null>, [string, string]>().mockResolvedValue('29123');
      const unwatch = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
      const multi = jest.fn<MockTxn, []>();
      const redisClient = createRedisClient([{
        hGet,
        multi,
        unwatch,
        watch,
      }]);

      const result = await appendTopicMessageWithDedupe({
        ...baseParams,
        redisClient: redisClient as unknown as Parameters<typeof appendTopicMessageWithDedupe>[0]['redisClient'],
      });

      expect(result).toBe('duplicate');
      expect(watch).toHaveBeenCalledWith(baseParams.watermarkKey);
      expect(hGet).toHaveBeenCalledWith(baseParams.watermarkKey, '0');
      expect(unwatch).toHaveBeenCalledTimes(1);
      expect(multi).not.toHaveBeenCalled();
    });

    it('inserts message when offset is newer', async () => {
      const txn = createTxn(['OK']);
      const watch = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
      const hGet = jest.fn<Promise<string | null>, [string, string]>().mockResolvedValue('29122');
      const multi = jest.fn<MockTxn, []>().mockReturnValue(txn);
      const redisClient = createRedisClient([{ hGet, multi, watch }]);

      const result = await appendTopicMessageWithDedupe({
        ...baseParams,
        redisClient: redisClient as unknown as Parameters<typeof appendTopicMessageWithDedupe>[0]['redisClient'],
      });

      expect(result).toBe('inserted');
      expect(txn.rPush).toHaveBeenCalledWith(baseParams.messagesKey, baseParams.serializedMessage);
      expect(txn.lTrim).toHaveBeenCalledWith(baseParams.messagesKey, -baseParams.maxMessages, -1);
      expect(txn.hSet).toHaveBeenCalledWith(baseParams.watermarkKey, '0', baseParams.offset);
      expect(txn.expire).toHaveBeenNthCalledWith(1, baseParams.messagesKey, baseParams.ttlSeconds);
      expect(txn.expire).toHaveBeenNthCalledWith(2, baseParams.watermarkKey, baseParams.ttlSeconds);
      expect(txn.exec).toHaveBeenCalledTimes(1);
    });

    it('retries once after WATCH conflict and then inserts', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const firstTxn = createTxn(null);
        const secondTxn = createTxn(['OK']);
        const redisClient = createRedisClient([
          {
            hGet: jest.fn<Promise<string | null>, [string, string]>().mockResolvedValue('29122'),
            multi: jest.fn<MockTxn, []>().mockReturnValue(firstTxn),
            watch: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
          },
          {
            hGet: jest.fn<Promise<string | null>, [string, string]>().mockResolvedValue('29122'),
            multi: jest.fn<MockTxn, []>().mockReturnValue(secondTxn),
            watch: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
          },
        ]);

        const result = await appendTopicMessageWithDedupe({
          ...baseParams,
          redisClient: redisClient as unknown as Parameters<typeof appendTopicMessageWithDedupe>[0]['redisClient'],
        });

        expect(result).toBe('inserted');
        expect(redisClient.executeIsolated).toHaveBeenCalledTimes(2);
        expect(firstTxn.exec).toHaveBeenCalledTimes(1);
        expect(secondTxn.exec).toHaveBeenCalledTimes(1);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('throws after exhausting WATCH conflict retries', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const redisClient = createRedisClient(Array.from({ length: 8 }, () => ({
          hGet: jest.fn<Promise<string | null>, [string, string]>().mockResolvedValue('29122'),
          multi: jest.fn<MockTxn, []>().mockReturnValue(createTxn(null)),
          watch: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
        })));

        await expect(appendTopicMessageWithDedupe({
          ...baseParams,
          redisClient: redisClient as unknown as Parameters<typeof appendTopicMessageWithDedupe>[0]['redisClient'],
        })).rejects.toThrow('Failed to append deduped topic message after 8 WATCH conflicts');
        expect(redisClient.executeIsolated).toHaveBeenCalledTimes(8);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });
});
