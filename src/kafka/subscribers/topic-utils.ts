import { createHash } from 'crypto';

export const toTopicGroupId = (topic: string): string => {
  const digest = createHash('sha1').update(topic).digest('hex').slice(0, 16);
  return `kafka-relay-topic-${digest}`;
};
