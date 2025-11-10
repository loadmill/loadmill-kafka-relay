
import { SubscribeOptions, SubscribeParams } from '../types';

import { addSubscriber } from './subscribers';

export const subscribe = async (
  { brokers, topic }: SubscribeParams,
  { connectionTimeout, sasl, ssl, timestamp }: SubscribeOptions,
): Promise<{ id: string }> => {
  const subscriber = await addSubscriber({ brokers, topic }, { connectionTimeout, sasl, ssl });
  await subscriber.subscribe(timestamp);
  return { id: subscriber.id };
};
