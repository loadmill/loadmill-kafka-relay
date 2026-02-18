import clamp from 'lodash/clamp';

export const MAX_SUBSCRIBER_TTL_SECONDS = 600; // 10 minutes
export const MAX_SUBSCRIBER_EXPIRY_TIME_MS = 10 * 1000 * 60; // 10 minutes
export const SUBSCRIBER_EXPIRY_CHECK_INTERVAL_MS = 1000 * 6; // 60 seconds

export const DEFAULT_MAX_SUBSCRIBER_MESSAGES = 1000;
export const MIN_MAX_SUBSCRIBER_MESSAGES = 10;
export const MAX_MAX_SUBSCRIBER_MESSAGES = 100_000;

export const DEFAULT_MAX_SUBSCRIBER_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MIN_MAX_SUBSCRIBER_BYTES = 64 * 1024; // 64 KiB
export const MAX_MAX_SUBSCRIBER_BYTES = 512 * 1024 * 1024; // 512 MiB

const clampNumber = (value: number, min: number, max: number): number => {
  return clamp(value, min, max);
};

const parseEnvNumber = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const MAX_SUBSCRIBER_MESSAGES = clampNumber(
  parseEnvNumber(process.env.MAX_SUBSCRIBER_MESSAGES, DEFAULT_MAX_SUBSCRIBER_MESSAGES),
  MIN_MAX_SUBSCRIBER_MESSAGES,
  MAX_MAX_SUBSCRIBER_MESSAGES,
);

export const MAX_SUBSCRIBER_BYTES = clampNumber(
  parseEnvNumber(process.env.MAX_SUBSCRIBER_BYTES, DEFAULT_MAX_SUBSCRIBER_BYTES),
  MIN_MAX_SUBSCRIBER_BYTES,
  MAX_MAX_SUBSCRIBER_BYTES,
);
