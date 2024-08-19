
import { SubscribeOptions, SubscribeParams } from '../types';

import { addSubscriber } from './subscribers';

export const subscribe = async (
  { brokers, topic }: SubscribeParams,
  { sasl, ssl, timestamp }: SubscribeOptions,
): Promise<{ id: string }> => {
  const subscriber = await addSubscriber({ brokers, topic }, { sasl, ssl });
  await subscriber.subscribe(timestamp);
  return { id: subscriber.id };
};
