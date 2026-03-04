export const MAX_SUBSCRIBER_TTL_SECONDS = 600; // 10 minutes
export const MAX_SUBSCRIBER_EXPIRY_TIME_MS = 10 * 1000 * 60; // 10 minutes
export const SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS = 1000 * 6; // 6 seconds

export const TOPIC_MESSAGES_TTL_SECONDS = MAX_SUBSCRIBER_TTL_SECONDS;
export const MAX_TOPIC_MESSAGES_LENGTH = 5000;
export const TOPIC_LEADER_LOCK_TTL_SECONDS = 6;
export const TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS = 2 * 1000;

export const TOPIC_CONSUMER_LOOKBACK_MS =
  Number(process.env.TOPIC_CONSUMER_LOOKBACK_MS) || 24 * 60 * 60 * 1000;

export const getTopicConsumerLookbackTimestamp = (): number =>
  Date.now() - TOPIC_CONSUMER_LOOKBACK_MS;
