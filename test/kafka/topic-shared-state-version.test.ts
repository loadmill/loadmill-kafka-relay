import { createHash } from 'crypto';

import {
  toTopicLeaderKey,
  toTopicMessagesKey,
  toTopicPartitionOffsetWatermarksKey,
} from '../../src/kafka/subscribers/redis-keys';
import {
  TOPIC_SHARED_STATE_VERSION,
  toTopicStateRedisNamespace,
} from '../../src/kafka/subscribers/topic-state-namespace';
import { toTopicGroupId } from '../../src/kafka/subscribers/topic-utils';

jest.mock('../../src/multi-instance', () => ({ thisRelayInstanceId: 'test-instance' }));

describe('topic shared state protocol namespace', () => {
  const topic = 'orders:created/test topic';
  const encodedTopic = encodeURIComponent(topic);
  const digest = createHash('sha1').update(topic).digest('hex').slice(0, 16);
  const legacyRedisNamespace = `kafka-relay:topics:${encodedTopic}`;
  const currentRedisNamespace = `kafka-relay:topics:v2:${encodedTopic}`;

  it('uses one explicit version for every current topic-scoped Redis key', () => {
    expect(TOPIC_SHARED_STATE_VERSION).toBe('v2');
    expect(toTopicStateRedisNamespace(topic)).toBe(currentRedisNamespace);
    expect(toTopicMessagesKey(topic)).toBe(`${currentRedisNamespace}:messages`);
    expect(toTopicLeaderKey(topic)).toBe(`${currentRedisNamespace}:leader`);
    expect(toTopicPartitionOffsetWatermarksKey(topic)).toBe(
      `${currentRedisNamespace}:partition-offset-watermarks`,
    );
  });

  it('keeps current Redis keys disjoint from the legacy list-based state', () => {
    const legacyKeys = new Set([
      `${legacyRedisNamespace}:messages`,
      `${legacyRedisNamespace}:leader`,
      `${legacyRedisNamespace}:partition-offset-watermarks`,
    ]);
    const currentKeys = [
      toTopicMessagesKey(topic),
      toTopicLeaderKey(topic),
      toTopicPartitionOffsetWatermarksKey(topic),
    ];

    expect(currentKeys.every(key => !legacyKeys.has(key))).toBe(true);
  });

  it('uses the same version in a Kafka group that is disjoint from the legacy group', () => {
    const legacyGroupId = `kafka-relay-topic-${digest}`;

    expect(toTopicGroupId(topic)).toBe(`kafka-relay-topic-v2-${digest}`);
    expect(toTopicGroupId(topic)).not.toBe(legacyGroupId);
  });
});
