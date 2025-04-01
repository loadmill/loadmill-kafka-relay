
import { filterMessages } from '../../src/kafka/consume';
import { ConsumedMessage } from '../../src/types';

describe('filterMessages', () => {
  const headerRegexFilter = 'header-filter-1';
  const regexFilter = 'regex-filter';
  it('should filter a message by a header', async () => {
    const message1 = { headers: {
      'key1': 'value1',
    },
    timestamp: 'stamp',
    value: 'message1',
    } as ConsumedMessage;

    const message2 = { headers: {
      'key1': 'value1', 'x-internal-request-id': 'header-filter-1',
    },
    timestamp: 'stamp2',
    value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, headerRegexFilter, regexFilter);
    expect(res).toEqual([message2]);
  });

  it('should filter a message once', async () => {
    const message1 = { headers: {
        'key1': 'value1',
      },
      timestamp: 'stamp',
      value: 'message1',
    } as ConsumedMessage;

    const message2 = { headers: {
        'key1': 'value1', 'x-internal-request-id': 'header-filter-1',
      },
      timestamp: 'stamp2',
      value: 'regex-filter',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, headerRegexFilter, regexFilter);
    expect(res).toEqual([message2]);
    expect(res.length).toEqual(1);
  });

  it('should filter a message by a value only', async () => {
    const regexFilter2 = 'request-id-2';
    const message1 = { headers: {
      'key1': 'value1',

    },
    timestamp: 'stamp',
    value: 'request-id-2',
    } as ConsumedMessage;

    const message2 = { headers: {
      'key1': 'value1', 'x-internal-request-id': 'header-filter-2',
    },
    timestamp: 'stamp2',
    value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, headerRegexFilter, regexFilter2);
    expect(res).toEqual([message1]);
  });

  it('should filter a message by either a value or a header value', async () => {
    const message1 = { headers: {
      'key1': 'value1',
    },
    timestamp: 'stamp',
    value: 'regex-filter',
    } as ConsumedMessage;

    const message2 = { headers: {
      'key1': 'value1', 'x-internal-request-id': 'header-filter-1',
    },
    timestamp: 'stamp2',
    value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, headerRegexFilter, regexFilter);
    expect(res).toEqual([message1, message2]);
  });

});
