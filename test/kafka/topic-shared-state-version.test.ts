import { createHash } from 'crypto';

import {
  toTopicLeaderKey,
  toTopicLeaderReadyKey,
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
  const previousRedisNamespace = `kafka-relay:topics:v2:${encodedTopic}`;
  const currentRedisNamespace = `kafka-relay:topics:v3:${encodedTopic}`;

  it('uses one explicit version for every current topic-scoped Redis key', () => {
    expect(TOPIC_SHARED_STATE_VERSION).toBe('v3');
    expect(toTopicStateRedisNamespace(topic)).toBe(currentRedisNamespace);
    expect(toTopicMessagesKey(topic)).toBe(`${currentRedisNamespace}:messages`);
    expect(toTopicLeaderKey(topic)).toBe(`${currentRedisNamespace}:leader`);
    expect(toTopicLeaderReadyKey(topic)).toBe(`${currentRedisNamespace}:leader-ready`);
    expect(toTopicPartitionOffsetWatermarksKey(topic)).toBe(
      `${currentRedisNamespace}:partition-offset-watermarks`,
    );
  });

  it('keeps current Redis keys disjoint from preceding protocol versions', () => {
    const precedingKeys = new Set(
      [legacyRedisNamespace, previousRedisNamespace].flatMap(namespace => [
        `${namespace}:messages`,
        `${namespace}:leader`,
        `${namespace}:leader-ready`,
        `${namespace}:partition-offset-watermarks`,
      ]),
    );
    const currentKeys = [
      toTopicMessagesKey(topic),
      toTopicLeaderKey(topic),
      toTopicLeaderReadyKey(topic),
      toTopicPartitionOffsetWatermarksKey(topic),
    ];

    expect(currentKeys.every(key => !precedingKeys.has(key))).toBe(true);
  });

  it('uses the same version in a Kafka group disjoint from preceding versions', () => {
    const legacyGroupId = `kafka-relay-topic-${digest}`;
    const previousGroupId = `kafka-relay-topic-v2-${digest}`;

    expect(toTopicGroupId(topic)).toBe(`kafka-relay-topic-v3-${digest}`);
    expect(toTopicGroupId(topic)).not.toBe(legacyGroupId);
    expect(toTopicGroupId(topic)).not.toBe(previousGroupId);
  });
});
