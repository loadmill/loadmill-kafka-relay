import { schema as avscSchema, Type } from 'avsc';

// Importing `src/kafka/subscribers/messages` pulls in `redis-keys`, which in turn
// imports multi-instance/subscribers code that starts a background `setInterval`.
// Mock `redis-keys` so unit tests don't create open handles.
jest.mock('../../src/kafka/subscribers/redis-keys', () => ({
  toTopicMessagesKey: () => 'dummy',
}));

// Defensive: `messages.ts` also imports redis client (not used by these tests).
jest.mock('../../src/redis/redis-client', () => ({
  getRedisClient: () => ({
    lRange: jest.fn(),
  }),
}));

const { normalizeConsumedMessageValue } = require('../../src/kafka/subscribers/messages') as typeof import('../../src/kafka/subscribers/messages');

describe('normalizeConsumedMessageValue (union wrapping)', () => {
  const schema: avscSchema.RecordType = {
    fields: [
      { name: 'foo', type: ['null', 'string'] },
    ],
    name: 'R',
    type: 'record',
  };

  it('parses Avro JSON (with union wrapper) via value.toString()', () => {
    // Important: use *unwrapped* unions in-memory (default behavior), so the
    // decoded object will look like { foo: 'bar' }.
    const avroType = Type.forSchema(schema, { wrapUnions: 'never' });

    const originalValue = { foo: 'bar' };

    const encoded = avroType.toBuffer(originalValue);
    const decoded = avroType.fromBuffer(encoded) as Type;

    expect(decoded).toEqual({ foo: 'bar' });

    const normalized = normalizeConsumedMessageValue(decoded);
    expect(normalized).toEqual({ foo: { string: 'bar' } });
  });
});
