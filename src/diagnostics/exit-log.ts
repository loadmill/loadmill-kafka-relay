import log from '../log';

import { getMemoryUsageStats } from './memory';

export const initExitHandlers = (): void => {

  const logExitContextAndExit = (signal: NodeJS.Signals) => {
    try {
      log.info(
        {
          exit: true,
          mem: getMemoryUsageStats(),
          node: process.version,
          pid: process.pid,
          reason: signal,
          uptimeSec: process.uptime(),
        },
        'LOADMILL RELAY EXIT CONTEXT',
      );
    } catch (_) {
      // ignore
    }

    process.exit(0);
  };

  process.once('SIGINT', () => {
    logExitContextAndExit('SIGINT');
  });

  process.once('SIGTERM', () => {
    logExitContextAndExit('SIGTERM');
  });
};
