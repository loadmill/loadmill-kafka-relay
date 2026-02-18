import {
  enforceMessageLimits,
  estimateConsumedMessageBytes,
} from '../../src/kafka/subscribers/message-limits';
import { ConsumedMessage } from '../../src/types';

const msg = (value: string): ConsumedMessage => {
  return {
    headers: { h: 'v' },
    key: 'k',
    timestamp: 't',
    value,
  } as ConsumedMessage;
};

describe('enforceMessageLimits', () => {
  it('evicts oldest when maxMessages exceeded', () => {
    const messages: ConsumedMessage[] = [msg('a'), msg('b'), msg('c')];

    const res = enforceMessageLimits(messages, { maxBytes: 10_000, maxMessages: 2 });

    expect(res.droppedCount).toBe(1);
    expect(messages.map((m) => m.value)).toEqual(['b', 'c']);
  });

  it('evicts oldest when maxBytes exceeded', () => {
    const m1 = msg('a');
    const m2 = msg('bb');
    const m3 = msg('ccc');
    const messages: ConsumedMessage[] = [m1, m2, m3];

    // Set maxBytes to exactly fit the last two messages.
    const maxBytes = estimateConsumedMessageBytes(m2) + estimateConsumedMessageBytes(m3);

    const res = enforceMessageLimits(messages, { maxBytes, maxMessages: 100 });

    expect(res).toEqual({
      droppedBytes: estimateConsumedMessageBytes(m1),
      droppedCount: 1,
    });
    expect(messages.map((m) => m.value)).toEqual(['bb', 'ccc']);
  });

  it('handles combined constraints deterministically and preserves retained order', () => {
    const m1 = msg('1');
    const m2 = msg('22');
    const m3 = msg('333');
    const m4 = msg('4444');
    const messages: ConsumedMessage[] = [m1, m2, m3, m4];

    const maxBytes = estimateConsumedMessageBytes(m3) + estimateConsumedMessageBytes(m4);

    enforceMessageLimits(messages, { maxBytes, maxMessages: 3 });

    expect(messages.map((m) => m.value)).toEqual(['333', '4444']);
  });
});
