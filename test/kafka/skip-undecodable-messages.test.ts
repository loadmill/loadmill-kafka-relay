import { EachMessagePayload } from '@confluentinc/kafka-javascript/types/kafkajs';

import { noMessageFoundReason } from '../../src/kafka/consume';
import { decode, UndecodableMessageError } from '../../src/kafka/schema-registry';
import { getSkippedMessages } from '../../src/kafka/subscribers';
import { RedisSubscriber } from '../../src/kafka/subscribers/redis-subscriber';
import { Subscriber } from '../../src/kafka/subscribers/subscriber';
import { getRedisClient } from '../../src/redis/redis-client';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));
jest.mock('../../src/kafka/subscribers/topic-consumers-manager', () => ({ ensureTopicConsumerRunning: jest.fn() }));
jest.mock('../../src/kafka/schema-registry', () => ({
  ...jest.requireActual('../../src/kafka/schema-registry'),
  decode: jest.fn(),
}));
jest.mock('../../src/kafka/subscribers', () => ({ getSkippedMessages: jest.fn() }));

const mockDecode = decode as jest.MockedFunction<typeof decode>;
const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;
const mockGetSkippedMessages = getSkippedMessages as jest.MockedFunction<typeof getSkippedMessages>;

const topic = 'core.fct.captured-order.test';
const notFound = () => new UndecodableMessageError(31394, 'Confluent_Schema_Registry - Schema 31394 not found');

const payload = (offset: string, value = `value-${offset}`): EachMessagePayload => ({
  heartbeat: jest.fn(),
  message: { headers: {}, key: null, offset, timestamp: '1700000000000', value: Buffer.from(value) },
  partition: 0,
  pause: jest.fn(),
  topic,
} as unknown as EachMessagePayload);

const makeRedisClient = () => {
  const multi = {
    exec: jest.fn().mockResolvedValue([]),
    expire: jest.fn(),
    hSet: jest.fn(),
    zAdd: jest.fn(),
    zRemRangeByRank: jest.fn(),
  };
  multi.expire.mockReturnValue(multi);
  multi.hSet.mockReturnValue(multi);
  multi.zAdd.mockReturnValue(multi);
  multi.zRemRangeByRank.mockReturnValue(multi);
  return { _multi: multi, hGet: jest.fn().mockResolvedValue(null), multi: jest.fn().mockReturnValue(multi) };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDecode.mockImplementation(async (value: Buffer) => value?.toString());
});

describe('Subscriber.addMessage (single instance)', () => {
  const subscriber = () => new Subscriber({ brokers: ['kafka:9092'], topic }, {}, undefined, undefined, false);

  it('skips an undecodable message, records it and keeps the valid message after it', async () => {
    const s = subscriber();
    mockDecode.mockRejectedValueOnce(notFound());

    await expect(s.addMessage(payload('0'))).resolves.toBeUndefined();
    await s.addMessage(payload('1', 'valid-marker'));

    expect((await s.getMessages()).map((m) => m.value)).toEqual(['valid-marker']);
    expect(await s.getSkippedMessages()).toEqual([
      { offset: '0', partition: 0, reason: 'Confluent_Schema_Registry - Schema 31394 not found', schemaId: 31394, timestamp: 1700000000000 },
    ]);
  });

  it('rethrows any other decode error so the consumer retries the message', async () => {
    const s = subscriber();
    const outage = new Error('connect ECONNREFUSED');
    mockDecode.mockRejectedValueOnce(outage);

    await expect(s.addMessage(payload('0'))).rejects.toBe(outage);
    expect(await s.getSkippedMessages()).toEqual([]);
  });
});

describe('fromKafkaToConsumedMessage with real decode', () => {
  it('keeps a message whose headers are a string and a repeated key (array)', async () => {
    const realDecode = jest.requireActual('../../src/kafka/schema-registry').decode;
    mockDecode.mockImplementation(realDecode);
    const { fromKafkaToConsumedMessage } = jest.requireActual('../../src/kafka/subscribers/messages');
    const message = {
      headers: { 'x-repeated': ['one', 'two', 'three', 'four', 'five'], 'x-trace': 'trace-abcdef' },
      key: null,
      offset: '0',
      timestamp: '1700000000000',
      value: Buffer.from('plain value'),
    };

    const consumed = await fromKafkaToConsumedMessage(message);

    expect(consumed.headers).toEqual({ 'x-repeated': 'one,two,three,four,five', 'x-trace': 'trace-abcdef' });
    expect(consumed.value).toBe('plain value');
  });
});

describe('RedisSubscriber.addMessage (multi instance)', () => {
  const subscriber = (redisClient: ReturnType<typeof makeRedisClient>) => {
    mockGetRedisClient.mockReturnValue(redisClient as never);
    return new RedisSubscriber({ brokers: ['kafka:9092'], topic }, {});
  };

  it('records the undecodable message under the topic\'s skipped key and stores no message', async () => {
    const redisClient = makeRedisClient();
    mockDecode.mockRejectedValueOnce(notFound());

    await expect(subscriber(redisClient).addMessage(payload('7'))).resolves.toBeUndefined();

    const skippedKey = 'kafka-relay:topics:v3:core.fct.captured-order.test:skipped-messages';
    expect(redisClient._multi.zAdd).toHaveBeenCalledTimes(1);
    expect(redisClient._multi.zAdd).toHaveBeenCalledWith(skippedKey, {
      score: 1700000000000,
      value: JSON.stringify({
        offset: '7',
        partition: 0,
        reason: 'Confluent_Schema_Registry - Schema 31394 not found',
        schemaId: 31394,
        timestamp: 1700000000000,
      }),
    });
    expect(redisClient._multi.zRemRangeByRank).toHaveBeenCalledWith(skippedKey, 0, -5001);
    expect(redisClient._multi.expire).toHaveBeenCalledWith(skippedKey, 600);
    expect(redisClient._multi.hSet).not.toHaveBeenCalled();
  });

  it('stores the valid message that follows an undecodable one', async () => {
    const redisClient = makeRedisClient();
    const s = subscriber(redisClient);
    mockDecode.mockRejectedValueOnce(notFound());

    await s.addMessage(payload('7'));
    await s.addMessage(payload('8', '{"orderId":"valid-marker"}'));

    const messagesKey = 'kafka-relay:topics:v3:core.fct.captured-order.test:messages';
    const stored = redisClient._multi.zAdd.mock.calls.filter(([key]) => key === messagesKey);
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0][1].value)).toMatchObject({ offset: '8', value: '{"orderId":"valid-marker"}' });
  });

  it('rethrows any other decode error and writes nothing', async () => {
    const redisClient = makeRedisClient();
    const outage = new Error('Confluent_Schema_Registry - Internal Server Error');
    mockDecode.mockRejectedValueOnce(outage);

    await expect(subscriber(redisClient).addMessage(payload('7'))).rejects.toBe(outage);
    expect(redisClient.multi).not.toHaveBeenCalled();
  });
});

describe('noMessageFoundReason', () => {
  it('names the skipped messages instead of the filter', async () => {
    mockGetSkippedMessages.mockResolvedValue([
      { offset: '7', partition: 0, reason: 'Schema 31394 not found', schemaId: 31394, timestamp: 1 },
    ]);

    await expect(noMessageFoundReason('id', 'valid-marker')).resolves.toBe(
      'No message found. 1 message on this topic could not be decoded and was skipped ' +
      '(schema ID 31394 not found in the schema registry). The message you are waiting for may be one of them: ' +
      'check the producer\'s schema.',
    );
  });

  it('keeps the existing hints when nothing was skipped', async () => {
    mockGetSkippedMessages.mockResolvedValue([]);

    await expect(noMessageFoundReason('id', 'x')).resolves.toBe('No message found. Maybe your regex filter is too restrictive?');
    await expect(noMessageFoundReason('id')).resolves.toBe(
      'No message found. Maybe the topic you provided when subscribing is either empty or not spelled correctly?',
    );
  });
});
