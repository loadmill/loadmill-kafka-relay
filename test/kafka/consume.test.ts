import { ClientError } from '../../src/errors';
import { consume } from '../../src/kafka/consume';
import { filterMessages } from '../../src/kafka/consume/consume-query';
import * as subscribers from '../../src/kafka/subscribers';
import { subscriptionsManager } from '../../src/kafka/subscribers/subscribers-manager-factory';
import { ConsumedMessage } from '../../src/types';

describe('filterMessages', () => {
  const headerRegexFilter = 'header-filter-1';
  const regexFilter = 'regex-filter';
  const headerRegex = new RegExp(headerRegexFilter);
  const valueRegex = new RegExp(regexFilter);
  it('should filter a message by a header', async () => {
    const message1 = {
      headers: {
        'key1': 'value1',
      },
      timestamp: 'stamp',
      value: 'message1',
    } as ConsumedMessage;

    const message2 = {
      headers: {
        'key1': 'value1',
        'x-internal-request-id': 'header-filter-1',
      },
      timestamp: 'stamp2',
      value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, {
      headerRegex,
      valueRegex,
    });
    expect(res).toEqual([message2]);
  });

  it('should filter a message once', async () => {
    const message1 = {
      headers: {
        'key1': 'value1',
      },
      timestamp: 'stamp',
      value: 'message1',
    } as ConsumedMessage;

    const message2 = {
      headers: {
        'key1': 'value1',
        'x-internal-request-id': 'header-filter-1',
      },
      timestamp: 'stamp2',
      value: 'regex-filter',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, {
      headerRegex,
      valueRegex,
    });
    expect(res).toEqual([message2]);
    expect(res.length).toEqual(1);
  });

  it('should filter a message by a value only', async () => {
    const regexFilter2 = 'request-id-2';
    const valueRegex2 = new RegExp(regexFilter2);
    const message1 = {
      headers: {
        'key1': 'value1',
      },
      timestamp: 'stamp',
      value: 'request-id-2',
    } as ConsumedMessage;

    const message2 = {
      headers: {
        'key1': 'value1',
        'x-internal-request-id': 'header-filter-2',
      },
      timestamp: 'stamp2',
      value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, {
      headerRegex,
      valueRegex: valueRegex2,
    });
    expect(res).toEqual([message1]);
  });

  it('should filter a message by either a value or a header value', async () => {
    const message1 = {
      headers: {
        'key1': 'value1',
      },
      timestamp: 'stamp',
      value: 'regex-filter',
    } as ConsumedMessage;

    const message2 = {
      headers: {
        'key1': 'value1',
        'x-internal-request-id': 'header-filter-1',
      },
      timestamp: 'stamp2',
      value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, {
      headerRegex,
      valueRegex,
    });
    expect(res).toEqual([message1, message2]);
  });

  afterAll(() => {
    subscriptionsManager.stopDeletingExpiredSubscribers();
  });
});

describe('consume', () => {
  const allMessages: ConsumedMessage[] = [
    { timestamp: '1', value: 'unrelated-1' },
    { timestamp: '2', value: 'order-ABC-first' },
    { timestamp: '3', value: 'unrelated-2' },
    { timestamp: '4', value: 'order-ABC-second' },
    { timestamp: '5', value: 'unrelated-3' },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(subscribers, 'getMessages').mockResolvedValue(allMessages);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    subscriptionsManager.stopDeletingExpiredSubscribers();
  });

  it('should return only messages matching regexFilter', async () => {
    const result = await consume(
      { id: 'sub-1' },
      { regexFilter: 'order-ABC', timeout: 1 },
    );

    expect(result).toEqual([
      expect.objectContaining({ timestamp: '4', value: 'order-ABC-second' }),
    ]);
  });

  it('should return multiple matching messages when multiple is set', async () => {
    const result = await consume(
      { id: 'sub-1' },
      { multiple: 2, regexFilter: 'order-ABC', timeout: 1 },
    );

    expect(result).toEqual([
      expect.objectContaining({ timestamp: '2', value: 'order-ABC-first' }),
      expect.objectContaining({ timestamp: '4', value: 'order-ABC-second' }),
    ]);
  });

  it('should return messages matching headerValueRegexFilter', async () => {
    const messagesWithHeaders: ConsumedMessage[] = [
      { headers: { 'x-req-id': 'abc-123' }, timestamp: '1', value: 'msg-1' },
      { headers: { 'x-req-id': 'def-456' }, timestamp: '2', value: 'msg-2' },
      { headers: { 'x-req-id': 'abc-789' }, timestamp: '3', value: 'msg-3' },
    ];
    jest.spyOn(subscribers, 'getMessages').mockResolvedValue(messagesWithHeaders);

    const result = await consume(
      { id: 'sub-1' },
      { headerValueRegexFilter: 'abc-', multiple: 2, timeout: 1 },
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ timestamp: '1' }));
    expect(result[1]).toEqual(expect.objectContaining({ timestamp: '3' }));
  });

  it('should throw 404 when no messages match the filter', async () => {
    const expectReject = expect(
      consume(
        { id: 'sub-1' },
        { regexFilter: 'no-match-pattern', timeout: 1 },
      ),
    ).rejects.toThrow(ClientError);

    await jest.advanceTimersByTimeAsync(3000);
    await expectReject;
  });

  it('should return the latest N messages when multiple < total matches', async () => {
    const result = await consume(
      { id: 'sub-1' },
      { multiple: 1, regexFilter: 'order-ABC', timeout: 1 },
    );

    expect(result).toEqual([
      expect.objectContaining({ timestamp: '4', value: 'order-ABC-second' }),
    ]);
  });

  it('should parse JSON values by default (text not set)', async () => {
    const jsonMessages: ConsumedMessage[] = [
      { timestamp: '1', value: '{"key":"value"}' },
    ];
    jest.spyOn(subscribers, 'getMessages').mockResolvedValue(jsonMessages);

    const result = await consume(
      { id: 'sub-1' },
      { timeout: 1 },
    );

    expect(result[0].value).toEqual({ key: 'value' });
  });

  it('should keep raw string values when text is "true"', async () => {
    const jsonMessages: ConsumedMessage[] = [
      { timestamp: '1', value: '{"key":"value"}' },
    ];
    jest.spyOn(subscribers, 'getMessages').mockResolvedValue(jsonMessages);

    const result = await consume(
      { id: 'sub-1' },
      { text: 'true', timeout: 1 },
    );

    expect(result[0].value).toEqual('{"key":"value"}');
  });
});
