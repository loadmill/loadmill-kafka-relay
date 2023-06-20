import { UUID } from 'crypto';

import { Consumer, KafkaConfig } from 'kafkajs';

export type Connections = {
  [id: string]: Subscriber;
};

export type Subscriber = {
  consumer: Consumer;
  messages: string[];
  timeOfSubscription: number;
  topic: string; // unix timestamp (Date.now())
};

export type ProduceOptions = SubscribeOptions & {
  encode?: EncodeSchemaOptions;
  message: string | object;
};

export type SubscribeOptions = Pick<KafkaConfig, 'sasl' | 'ssl'> & {
  brokers: string[];
  topic: string;
};

export type ConsumeOptions = {
  id: UUID;
  regexFilter?: string;
  timeout?: number; /** in seconds */
};

export type RegistryOptions = {
  auth?: {
    password: string;
    username: string;
  };
  encode?: EncodeSchemaOptions;
  url: string;
};

export type EncodeSchemaOptions = {
  subject: string;
  version?: number;
};
