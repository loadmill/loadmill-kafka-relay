export const MAX_SUBSCRIBER_TTL_SECONDS = 600; // 10 minutes
export const MAX_SUBSCRIBER_EXPIRY_TIME_MS = 10 * 1000 * 60; // 10 minutes
export const SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS = 1000 * 6; // 60 seconds

// Topic-level storage (shared across subscribers of the same topic)
export const TOPIC_MESSAGES_TTL_SECONDS = MAX_SUBSCRIBER_TTL_SECONDS;

// Bound the Redis list to avoid unbounded growth + huge LRANGE responses.
export const MAX_TOPIC_MESSAGES_LENGTH = 5000;

// Multi-instance leader election per topic.
// Keep the lease short so failover after an ungraceful crash is fast.
// The renew interval should be comfortably smaller than the TTL.
export const TOPIC_LEADER_LOCK_TTL_SECONDS = 6;
export const TOPIC_LEADER_LOCK_RENEW_INTERVAL_MS = 2 * 1000;
