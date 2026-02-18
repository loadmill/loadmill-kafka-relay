import clamp from 'lodash/clamp';

import { ConsumedMessage } from '../../types';

export type MessageLimitOptions = {
  maxBytes: number;
  maxMessages: number;
};

export type EvictionMetadata = {
  droppedBytes: number;
  droppedCount: number;
};

/**
 * Cheap approximate size estimator.
 *
 * Constraints:
 * - Allocation-light
 * - Avoid JSON.stringify full objects
 */
export const estimateConsumedMessageBytes = (message: ConsumedMessage): number => {
  let bytes = 0;

  // timestamp is always a string per type
  bytes += message.timestamp?.length || 0;

  if (message.key) {
    bytes += message.key.length;
  }

  const value = message.value;
  if (typeof value === 'string') {
    bytes += value.length;
  } else if (value != null) {
    // avsc Type object or similar; avoid deep inspection
    bytes += 64;
  }

  const headers = message.headers;
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      bytes += k.length;
      if (v) {
        bytes += v.length;
      }
    }
  }

  // KafkaMessage spread fields included in fromKafkaToConsumedMessage() can contain buffers/objects.
  // Keep a small constant overhead per message for safety.
  bytes += 128;

  return bytes;
};

export const clampMessageLimit = (value: number, min: number, max: number): number => {
  return clamp(value, min, max);
};

export const enforceMessageLimits = (
  messages: ConsumedMessage[],
  { maxMessages, maxBytes }: MessageLimitOptions,
): EvictionMetadata => {
  // Fast path
  if (messages.length === 0) {
    return { droppedBytes: 0, droppedCount: 0 };
  }

  // If caps are effectively disabled, skip work.
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) {
    maxMessages = Infinity;
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    maxBytes = Infinity;
  }

  // Approximate total bytes. This is O(n) but bounded by caps in steady-state.
  // It avoids allocations besides a few locals.
  let totalBytes = 0;
  for (let i = 0; i < messages.length; i++) {
    totalBytes += estimateConsumedMessageBytes(messages[i]);
  }

  let droppedCount = 0;
  let droppedBytes = 0;

  while (messages.length > maxMessages || totalBytes > maxBytes) {
    const dropped = messages.shift();
    if (!dropped) {
      break;
    }
    const size = estimateConsumedMessageBytes(dropped);
    totalBytes -= size;
    droppedCount += 1;
    droppedBytes += size;
  }

  return { droppedBytes, droppedCount };
};
