
import { filterMessages } from '../../src/kafka/consume';
import { ConsumedMessage } from '../../src/types';

describe('filterMessages', () => {
  it('should filter a message by a header', async () => {
    const regexFilter = 'request-id-1';
    const message1 = { headers: {
      'key1': 'value1',

    },
    timestamp: 'stamp',
    value: 'message1',
    } as ConsumedMessage;

    const message2 = { headers: {
      'key1': 'value1', 'x-internal-request-id': 'request-id-1',
    },
    timestamp: 'stamp2',
    value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, regexFilter);
    expect(res).toEqual([message2]);
  });

  it('should filter a message by a value only', async () => {
    const regexFilter = 'request-id-2';
    const message1 = { headers: {
        'key1': 'value1',

      },
      timestamp: 'stamp',
      value: 'request-id-2',
    } as ConsumedMessage;

    const message2 = { headers: {
        'key1': 'value1', 'x-internal-request-id': 'request-id-1',
      },
      timestamp: 'stamp2',
      value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, regexFilter);
    expect(res).toEqual([message1]);
  });

  it('should filter a message by a value and header', async () => {
    const regexFilter = 'request-id-1';
    const message1 = { headers: {
      'key1': 'value1',
    },
    timestamp: 'stamp',
    value: 'request-id-1',
    } as ConsumedMessage;

    const message2 = { headers: {
      'key1': 'value1', 'x-internal-request-id': 'request-id-1',
    },
    timestamp: 'stamp2',
    value: 'message2',
    } as ConsumedMessage;

    const consumedMessages = [message1, message2];
    const res = filterMessages(consumedMessages, regexFilter);
    expect(res).toEqual([message1, message2]);
  });

});
