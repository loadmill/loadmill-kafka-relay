import { createHash } from 'crypto';

export const toTopicGroupId = (topic: string): string => {
  // Keep groupId short and charset-safe while staying stable per topic.
  const digest = createHash('sha1').update(topic).digest('hex').slice(0, 16);
  return `kafka-relay-topic-${digest}`;
};
