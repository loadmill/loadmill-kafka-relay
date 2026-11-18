import {
  clearMissingSchemaIds,
  decode,
  initSchemaRegistry,
  readSchemaId,
  UndecodableMessageError,
} from '../../src/kafka/schema-registry';
import { describeSkippedMessages, SkippedMessage } from '../../src/kafka/subscribers/undecodable-messages';

jest.mock('../../src/redis/redis-client');
jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));

const mockRegistryDecode = jest.fn();

jest.mock('@kafkajs/confluent-schema-registry', () => ({
  ...jest.requireActual('@kafkajs/confluent-schema-registry'),
  SchemaRegistry: jest.fn().mockImplementation(() => ({ decode: mockRegistryDecode })),
}));

const wireFormat = (schemaId: number): Buffer => {
  const buffer = Buffer.alloc(7);
  buffer.writeUInt8(0, 0);
  buffer.writeInt32BE(schemaId, 1);
  return buffer;
};

const responseError = (status: number, message: string): Error =>
  Object.assign(new Error(message), { name: 'ResponseError', status });

describe('readSchemaId', () => {
  it('reads the schema ID from the Confluent wire format', () => {
    expect(readSchemaId(wireFormat(31394))).toBe(31394);
  });

  it('returns undefined when the value is not in the wire format', () => {
    expect(readSchemaId(Buffer.from('plain text'))).toBeUndefined();
    expect(readSchemaId(Buffer.from([0, 1]))).toBeUndefined();
    expect(readSchemaId(null)).toBeUndefined();
    // header values that are not Buffers: a string and a repeated header (array) of 5+ entries
    expect(readSchemaId('a string header value')).toBeUndefined();
    expect(readSchemaId(['a', 'b', 'c', 'd', 'e'])).toBeUndefined();
  });
});

describe('decode', () => {
  const notFound = () => responseError(404, 'Confluent_Schema_Registry - Schema 31394 not found');

  // Runs decode while advancing fake time through the re-check delays.
  const decodeSettled = async (value: Buffer) => {
    const result = decode(value).then((v) => ({ v }), (e) => ({ e }));
    await jest.advanceTimersByTimeAsync(2000);
    return result;
  };

  beforeAll(async () => {
    await initSchemaRegistry({ url: 'http://registry.test' });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockRegistryDecode.mockReset();
    clearMissingSchemaIds();
  });

  afterEach(() => jest.useRealTimers());

  it('throws UndecodableMessageError with the schema ID once the registry confirms the schema is missing', async () => {
    mockRegistryDecode.mockRejectedValue(notFound());

    const { e } = await decodeSettled(wireFormat(31394)) as { e: UndecodableMessageError };

    expect(e).toBeInstanceOf(UndecodableMessageError);
    expect(e.schemaId).toBe(31394);
    expect(e.reason).toBe('Confluent_Schema_Registry - Schema 31394 not found');
    expect(mockRegistryDecode).toHaveBeenCalledTimes(3);
  });

  it('decodes the message when a re-check finds the schema (registry replica lag)', async () => {
    mockRegistryDecode.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ orderId: 'abc' });

    await expect(decodeSettled(wireFormat(31394))).resolves.toEqual({ v: { orderId: 'abc' } });
    expect(mockRegistryDecode).toHaveBeenCalledTimes(2);
  });

  it('skips later messages with a confirmed missing schema ID without asking the registry again', async () => {
    mockRegistryDecode.mockRejectedValue(notFound());
    await decodeSettled(wireFormat(31394));
    mockRegistryDecode.mockClear();

    await expect(decode(wireFormat(31394))).rejects.toBeInstanceOf(UndecodableMessageError);
    expect(mockRegistryDecode).not.toHaveBeenCalled();
  });

  it('asks the registry again once the missing schema ID has expired from the cache', async () => {
    mockRegistryDecode.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound());
    await decodeSettled(wireFormat(31394));
    jest.advanceTimersByTime(61 * 1000);
    mockRegistryDecode.mockResolvedValueOnce({ orderId: 'registered-later' });

    await expect(decode(wireFormat(31394))).resolves.toEqual({ orderId: 'registered-later' });
  });

  it.each([
    ['a registry server error', responseError(500, 'Confluent_Schema_Registry - Internal Server Error')],
    ['an auth error', responseError(401, 'Confluent_Schema_Registry - Unauthorized')],
    ['a network error', new Error('connect ECONNREFUSED 10.0.0.1:8081')],
  ])('rethrows %s at once and unchanged so the message is retried', async (_, registryError) => {
    mockRegistryDecode.mockRejectedValue(registryError);

    await expect(decode(wireFormat(30505))).rejects.toBe(registryError);
    expect(mockRegistryDecode).toHaveBeenCalledTimes(1);
  });

  it('asks a newly configured registry about an ID the previous one did not have', async () => {
    mockRegistryDecode.mockRejectedValue(notFound());
    await decodeSettled(wireFormat(31394));
    await initSchemaRegistry({ url: 'http://other-registry.test' });
    mockRegistryDecode.mockReset().mockResolvedValue({ orderId: 'in-the-new-registry' });

    await expect(decode(wireFormat(31394))).resolves.toEqual({ orderId: 'in-the-new-registry' });
    expect(mockRegistryDecode).toHaveBeenCalledTimes(1);
    await initSchemaRegistry({ url: 'http://registry.test' });
  });

  it('keeps the missing-schema cache when the same registry URL is set again', async () => {
    mockRegistryDecode.mockRejectedValue(notFound());
    await decodeSettled(wireFormat(31394));
    await initSchemaRegistry({ url: 'http://registry.test' });
    mockRegistryDecode.mockClear();

    await expect(decode(wireFormat(31394))).rejects.toBeInstanceOf(UndecodableMessageError);
    expect(mockRegistryDecode).not.toHaveBeenCalled();
  });

  it('never sends a non-Buffer value to the registry', async () => {
    // the registry rejects these with "Invalid buffer"; the caller falls back to their string form
    mockRegistryDecode.mockRejectedValue(new Error('Invalid buffer'));

    await expect(decode(['a', 'b', 'c', 'd', 'e'] as unknown as Buffer)).resolves.toBeUndefined();
    await expect(decode('plain header' as unknown as Buffer)).resolves.toBeUndefined();
    await expect(decode(null as unknown as Buffer)).resolves.toBeUndefined();
    expect(mockRegistryDecode).not.toHaveBeenCalled();
  });

  it('returns the decoded value when the schema exists', async () => {
    mockRegistryDecode.mockResolvedValue({ orderId: 'abc' });

    await expect(decode(wireFormat(30505))).resolves.toEqual({ orderId: 'abc' });
  });
});

describe('describeSkippedMessages', () => {
  const skipped = (overrides: Partial<SkippedMessage> = {}): SkippedMessage => ({
    offset: '0',
    partition: 0,
    reason: 'Confluent_Schema_Registry - Schema 31394 not found',
    schemaId: 31394,
    timestamp: 1,
    ...overrides,
  });

  it('returns undefined when nothing was skipped', () => {
    expect(describeSkippedMessages([])).toBeUndefined();
  });

  it('names one skipped message and its schema ID', () => {
    expect(describeSkippedMessages([skipped()])).toBe(
      '1 message on this topic could not be decoded and was skipped (schema ID 31394 not found in the schema registry). ' +
      'The message you are waiting for may be one of them: check the producer\'s schema.',
    );
  });

  it('counts every skipped message and lists each schema ID once', () => {
    const text = describeSkippedMessages([
      skipped({ offset: '0' }),
      skipped({ offset: '1' }),
      skipped({ offset: '2', schemaId: 40000 }),
    ]);
    expect(text).toContain('3 messages on this topic could not be decoded and were skipped');
    expect(text).toContain('(schema ID 31394, 40000 not found in the schema registry)');
  });

  it('still reports messages whose schema ID could not be read', () => {
    expect(describeSkippedMessages([skipped({ schemaId: undefined })])).toContain(
      '(schema not found in the schema registry)',
    );
  });
});
