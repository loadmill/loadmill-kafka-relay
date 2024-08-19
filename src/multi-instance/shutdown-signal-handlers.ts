import log from '../log';

export const registerExitEventHandlers = (cb: () => Promise<void>): void => {
  process.on('SIGINT', async () => {
    await shutdownHandler('SIGINT', cb);
  });

  process.on('SIGTERM', async () => {
    await shutdownHandler('SIGTERM', cb);
  });
};

const shutdownHandler = async (signal: NodeJS.Signals, cb: () => Promise<void>) => {
  log.info(`Received ${signal}`);
  await cb();
  log.info('Exiting');
  process.exit(0);
};
