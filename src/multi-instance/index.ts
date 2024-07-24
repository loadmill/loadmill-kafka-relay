
import log from '../log';

import {
  announceShutdown,
  registerInstance,
  unregisterInstance,
} from './instance-manager';
import { thisRelayInstanceId } from './relay-instance-id';
import { registerExitEventHandlers } from './shutdown-signal-handlers';

log.info({ thisRelayInstanceId }, 'Initialized Instance');

void registerInstance();

registerExitEventHandlers(async () => {
  await unregisterInstance();
  await announceShutdown();
});

export { thisRelayInstanceId };
