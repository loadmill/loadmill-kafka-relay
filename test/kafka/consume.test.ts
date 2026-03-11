import { consume, isMessageMatchesConsumeFilters } from '../../src/kafka/consume';
import * as subscribers from '../../src/kafka/subscribers';
import { subscriptionsManager } from '../../src/kafka/subscribers/subscribers-manager-factory';
import { ConsumedMessage } from '../../src/types';

jest.mock('../../src/kafka/subscribers', () => ({
  getMessages: jest.fn(),
}));

const mockGetMessages = subscribers.getMessages as jest.Mock;

const makeMsg = (value: string, headers?: Record<string, string>): ConsumedMessage => ({
  headers: headers ?? {},
  timestamp: '1000',
  value,
});

/**
 * Sets up getMessages mock to properly simulate the paginated interface.
 * Returns messages sliced from the tail respecting limit and offset.
 */
const setupMessagesMock = (allMessages: ConsumedMessage[]): void => {
  mockGetMessages.mockImplementation((_id: string, limit: number, offset: number) => {
    const end = allMessages.length - offset;
    const start = Math.max(0, end - limit);
    if (end <= 0) {
      return Promise.resolve([]);
    }
    return Promise.resolve(allMessages.slice(start, end));
  });
};

// --- consume behavior tests ---

describe('consume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    subscriptionsManager.stopDeletingExpiredSubscribers();
  });

  it('returns the single latest message when no filter is applied', async () => {
    const messages = [makeMsg('msg1'), makeMsg('msg2'), makeMsg('msg3')];
    setupMessagesMock(messages);

    const result = await consume({ id: 'sub1' }, { text: 'true' });

    expect(result).toEqual([makeMsg('msg3')]);
  });

  it('returns the N latest messages when multiple is set and no filter', async () => {
    const messages = [makeMsg('msg1'), makeMsg('msg2'), makeMsg('msg3')];
    setupMessagesMock(messages);

    const result = await consume({ id: 'sub1' }, { multiple: 2, text: 'true' });

    expect(result).toEqual([makeMsg('msg2'), makeMsg('msg3')]);
  });

  it('returns only messages matching regexFilter', async () => {
    const messages = [makeMsg('foo'), makeMsg('bar'), makeMsg('match-this')];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, { regexFilter: 'match', text: 'true' });

    expect(result).toEqual([makeMsg('match-this')]);
  });

  it('returns only messages with matching header value', async () => {
    const messages = [
      makeMsg('msg1', { 'x-id': 'no-match' }),
      makeMsg('msg2', { 'x-id': 'request-123' }),
    ];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, { headerValueRegexFilter: 'request-\\d+', text: 'true' });

    expect(result).toEqual([makeMsg('msg2', { 'x-id': 'request-123' })]);
  });

  it('returns messages matching either regexFilter or headerValueRegexFilter (OR logic)', async () => {
    const messages = [
      makeMsg('value-match'),
      makeMsg('other', { 'x-id': 'header-match' }),
      makeMsg('no-match'),
    ];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, {
      headerValueRegexFilter: 'header-match',
      regexFilter: 'value-match',
      text: 'true',
    });

    // multiple defaults to 1 → latest match
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('other');
  });

  it('returns N latest matching messages with regexFilter and multiple', async () => {
    const messages = [
      makeMsg('match-1'),
      makeMsg('no'),
      makeMsg('match-2'),
      makeMsg('match-3'),
    ];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, { multiple: 2, regexFilter: 'match', text: 'true' });

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('match-2');
    expect(result[1].value).toBe('match-3');
  });

  it('returns the latest matching message, not the first', async () => {
    const messages = [makeMsg('match-first'), makeMsg('no-match'), makeMsg('match-last')];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, { multiple: 1, regexFilter: 'match', text: 'true' });

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('match-last');
  });

  it('returns all matches when multiple exceeds total number of matches', async () => {
    const messages = [makeMsg('match-1'), makeMsg('no'), makeMsg('match-2')];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, { multiple: 10, regexFilter: 'match', text: 'true' });

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('match-1');
    expect(result[1].value).toBe('match-2');
  });

  it('JSON-parses message values when text is not set', async () => {
    const messages = [makeMsg('{"key":"value"}')];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, {});

    expect(result[0].value).toEqual({ key: 'value' });
  });

  it('returns raw string when value is not valid JSON and text is not set', async () => {
    const messages = [makeMsg('plain-string')];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, {});

    expect(result[0].value).toBe('plain-string');
  });

  it('returns raw string values when text is "true"', async () => {
    const messages = [makeMsg('{"key":"value"}')];
    mockGetMessages.mockResolvedValue(messages);

    const result = await consume({ id: 'sub1' }, { text: 'true' });

    expect(result[0].value).toBe('{"key":"value"}');
  });
});

// --- consume timeout behavior tests (requires fake timers) ---

describe('consume timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    subscriptionsManager.stopDeletingExpiredSubscribers();
  });

  it('throws ClientError 404 when no matches are found within timeout', async () => {
    mockGetMessages.mockResolvedValue([makeMsg('no-match')]);

    const promise = consume({ id: 'sub1' }, { regexFilter: 'xyz', timeout: 1 });
    const assertion = expect(promise).rejects.toMatchObject({ statusCode: 404 });
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('throws ClientError 404 when message store is empty', async () => {
    mockGetMessages.mockResolvedValue([]);

    const promise = consume({ id: 'sub1' }, { timeout: 1 });
    const assertion = expect(promise).rejects.toMatchObject({ statusCode: 404 });
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('does not crash when messages have no headers and headerValueRegexFilter is set', async () => {
    const messages = [{ timestamp: '1000', value: 'msg' } as ConsumedMessage];
    mockGetMessages.mockResolvedValue(messages);

    const promise = consume({ id: 'sub1' }, { headerValueRegexFilter: 'something', timeout: 1 });
    const assertion = expect(promise).rejects.toMatchObject({ statusCode: 404 });
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});

// --- isMessageMatchesConsumeFilters unit tests ---

describe('isMessageMatchesConsumeFilters', () => {
  const headerRegex = /header-filter-1/;
  const valueRegex = /regex-filter/;

  it('matches a message by header value', () => {
    const message = {
      headers: { 'key1': 'value1', 'x-internal-request-id': 'header-filter-1' },
      timestamp: 'stamp',
      value: 'message1',
    } as ConsumedMessage;

    expect(isMessageMatchesConsumeFilters(message, { headerRegex, valueRegex })).toBe(true);
  });

  it('does not double-count a message matching both header and value', () => {
    const message = {
      headers: { 'x-internal-request-id': 'header-filter-1' },
      timestamp: 'stamp',
      value: 'regex-filter',
    } as ConsumedMessage;

    expect(isMessageMatchesConsumeFilters(message, { headerRegex, valueRegex })).toBe(true);
  });

  it('matches a message by value only', () => {
    const message = {
      headers: { 'key1': 'value1' },
      timestamp: 'stamp',
      value: 'request-id-2',
    } as ConsumedMessage;

    expect(isMessageMatchesConsumeFilters(message, { headerRegex: null, valueRegex: /request-id-2/ })).toBe(true);
  });

  it('matches a message by either value or header value (OR logic)', () => {
    const valueOnlyMatch = { headers: { 'key1': 'value1' }, timestamp: 'stamp', value: 'regex-filter' } as ConsumedMessage;
    const headerOnlyMatch = { headers: { 'x-internal-request-id': 'header-filter-1' }, timestamp: 'stamp2', value: 'message2' } as ConsumedMessage;
    const noMatch = { headers: { 'key1': 'value1' }, timestamp: 'stamp3', value: 'unrelated' } as ConsumedMessage;

    expect(isMessageMatchesConsumeFilters(valueOnlyMatch, { headerRegex, valueRegex })).toBe(true);
    expect(isMessageMatchesConsumeFilters(headerOnlyMatch, { headerRegex, valueRegex })).toBe(true);
    expect(isMessageMatchesConsumeFilters(noMatch, { headerRegex, valueRegex })).toBe(false);
  });
});
