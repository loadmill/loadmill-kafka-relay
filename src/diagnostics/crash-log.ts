import log from '../log';

import { getMemoryUsageStats } from './memory';

const getNodeVersion = (): string => process.version;

export const initCrashLog = (): void => {
  const logCrashContext = (reason: string, err?: unknown) => {
    try {
      const error = err instanceof Error ? err : undefined;

      log.fatal(
        {
          crash: true,
          error: error?.message,
          mem: getMemoryUsageStats(),
          node: getNodeVersion(),
          reason,
          stack: error?.stack,
          uptimeSec: process.uptime(),
        },
        'LOADMILL KAFKA RELAY CRASH CONTEXT',
      );
    } catch (e) {
      try {
        process.stderr.write(`LOADMILL KAFKA RELAY CRASH CONTEXT (fallback): ${String(e)}\n`);
      } catch (_) {
        // ignore
      }
    }
  };

  process.on('uncaughtException', (err) => {
    logCrashContext('uncaughtException', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (err) => {
    logCrashContext('unhandledRejection', err);
    process.exit(1);
  });

  process.on('warning', (warning) => {
    try {
      log.warn(
        {
          warning: {
            message: warning.message,
            name: warning.name,
            stack: warning.stack,
          },
        },
        'NODE WARNING',
      );
    } catch (_) {
      // ignore
    }
  });
};
