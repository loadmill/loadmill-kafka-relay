import { getTopicsUsageForLog } from '../../src/diagnostics/periodic-diagnostics';
import { getRedisClient } from '../../src/redis/redis-client';

jest.mock('../../src/kafka/subscribers', () => ({
  getLocalSubscribers: jest.fn(),
}));
jest.mock('../../src/multi-instance', () => ({
  isMultiInstance: jest.fn(),
}));
jest.mock('../../src/redis/redis-client');

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

describe('periodic topic diagnostics', () => {
  it('uses sorted-set cardinality for the versioned topic message buffer', async () => {
    const lLen = jest.fn();
    const sendCommand = jest.fn().mockResolvedValue(2 * 1024 * 1024);
    const zCard = jest.fn().mockResolvedValue(17);
    mockGetRedisClient.mockReturnValue({ lLen, sendCommand, zCard } as never);

    const topic = 'orders:created/test topic';
    const subscribers = {
      first: { topic },
      second: { topic },
    } as never;

    const result = await getTopicsUsageForLog(subscribers);

    const messagesKey = 'kafka-relay:topics:v3:orders%3Acreated%2Ftest%20topic:messages';
    expect(zCard).toHaveBeenCalledTimes(1);
    expect(zCard).toHaveBeenCalledWith(messagesKey);
    expect(lLen).not.toHaveBeenCalled();
    expect(sendCommand).toHaveBeenCalledWith(['MEMORY', 'USAGE', messagesKey]);
    expect(result).toEqual([{
      bytesMiB: 2,
      messages: 17,
      subscribers: 2,
      topic,
    }]);
  });
});
