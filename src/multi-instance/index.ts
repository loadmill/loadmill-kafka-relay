import log from '../log';

import {
  onShutdown,
  registerInstance,
  subscribeToShutdownAnnouncement,
} from './instance-manager';
import { isMultiInstance } from './is-multi-instance';
import { thisRelayInstanceId } from './relay-instance-id';
import { registerExitEventHandlers } from './shutdown-signal-handlers';

const initializeMultiInstance = async (): Promise<void> => {
  log.info({ thisRelayInstanceId }, 'Initialized instance');
  await subscribeToShutdownAnnouncement();
  await registerInstance();
  registerExitEventHandlers(onShutdown);
};

export {
  isMultiInstance,
  initializeMultiInstance,
  thisRelayInstanceId,
};
