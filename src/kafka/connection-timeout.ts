import clamp from 'lodash/clamp';

import log from '../log';

export const DEFAULT_CONNECTION_TIMEOUT = 1000;
export const MIN_CONNECTION_TIMEOUT = 1000;
export const MAX_CONNECTION_TIMEOUT = 30000;

export const getConnectionTimeout = (timeoutInMS?: number): number => {
  const connectionTimeout = _getConnectionTimeout(timeoutInMS);
  log.debug(`Using connection timeout of ${connectionTimeout} ms`);
  return connectionTimeout;
};

const _getConnectionTimeout = (timeoutInMS?: number): number => {
  return clamp(
    timeoutInMS ||
    Number(process.env.CONNECTION_TIMEOUT) ||
    DEFAULT_CONNECTION_TIMEOUT,
    MIN_CONNECTION_TIMEOUT,
    MAX_CONNECTION_TIMEOUT,
  );
};

process.env.CONNECTION_TIMEOUT && log.info({ CONNECTION_TIMEOUT: process.env.CONNECTION_TIMEOUT }, 'Connection timeout from env variable');
