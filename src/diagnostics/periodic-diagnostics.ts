import { getLocalSubscribers } from '../kafka/subscribers';
import { toMessagesKey } from '../kafka/subscribers/redis-keys';
import { RedisSubscribers } from '../kafka/subscribers/redis-subscriber';
import { Subscriber } from '../kafka/subscribers/subscriber';
import log from '../log';
import { isMultiInstance } from '../multi-instance';
import { getRedisClient } from '../redis/redis-client';

import { getEndpointsCallsCounters } from './endpoint-counters';
import { bytesToMiB, getMemoryUsageStats } from './memory';

export const initPeriodicDiagnosticsLogger = (): void => {
  if (!isMultiInstance() || process.env.MULTI_INSTANCE_DIAGNOSTICS_LOGGING !== 'true') {
    return;
  }

  const timer = setInterval(() => {
    void (async () => {
      try {
        const http = getEndpointsCallsCounters();

        const subscribers = getLocalSubscribers();

        log.info(
          {
            diag: {
              aliveSubscribers: Object.keys(subscribers).length,
              calls: http,
              endpoint: 'periodic_diagnostics',
              memory: getMemoryUsageStats(),
              pid: process.pid,
              topics: await _getTopicsUsageForLog(subscribers),
              uptimeSec: process.uptime(),
            },
          },
          'PERIODIC DIAGNOSTICS',
        );
      } catch (_) {
        // ignore
      }
    })();
  }, 60 * 1000);

  timer.unref();
};

const _getTopicsUsageForLog = async (subscribers: RedisSubscribers): Promise<_TopicDiagnosticsLog[]> => {
  const rawTopicsUsage: _RawTopicsUsage = await _getRawTopicsUsage(subscribers);
  return _mapToTopicDiagnosticsLog(rawTopicsUsage);
};

const _getRawTopicsUsage = async (subscribers: RedisSubscribers): Promise<_RawTopicsUsage> => {
  const rawTopicsUsage: _RawTopicsUsage = {};

  await Promise.all(
    Object.values(subscribers)
      .map(subscriber => _addSubscriberUsage(rawTopicsUsage, subscriber)),
  );
  return rawTopicsUsage;
};

const _addSubscriberUsage = async (rawTopicsUsage: _RawTopicsUsage, subscriber: Subscriber) => {
  const messagesKey = toMessagesKey(subscriber.id);

  const [numberOfMessages, redisBytes] = await Promise.all([
    getRedisClient().lLen(messagesKey),
    getRedisClient().sendCommand(['MEMORY', 'USAGE', messagesKey]),
  ]);

  const numberOfBytes = _toNumberOrZero(redisBytes);

  const totals = rawTopicsUsage[subscriber.topic] ?? { bytes: 0, messages: 0, subscribers: 0 };
  totals.bytes += numberOfBytes;
  totals.messages += numberOfMessages;
  totals.subscribers += 1;
  rawTopicsUsage[subscriber.topic] = totals;
};

const _toNumberOrZero = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const _mapToTopicDiagnosticsLog = (byTopic: _RawTopicsUsage): _TopicDiagnosticsLog[] => {
  return Object.entries(byTopic)
    .map(([topic, totals]) => {
      return {
        bytesMiB: bytesToMiB(totals.bytes),
        messages: totals.messages,
        subscribers: totals.subscribers,
        topic,
      };
    })
    .sort(_compareByLargestMemory);
};

const _compareByLargestMemory = (a: _TopicDiagnosticsLog, b: _TopicDiagnosticsLog): number => {
  return b.bytesMiB - a.bytesMiB;
};

type _RawTopicsUsage = Record<string, {
  bytes: number;
  messages: number;
  subscribers: number;
}>;

type _TopicDiagnosticsLog = {
  bytesMiB: number;
  messages: number;
  subscribers: number;
  topic: string;
};
