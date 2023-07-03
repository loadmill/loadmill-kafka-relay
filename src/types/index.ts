import { UUID } from 'crypto';

import { Consumer, KafkaConfig, KafkaMessage } from 'kafkajs';

export type Connections = {
  [id: string]: Subscriber;
};

export type Subscriber = {
  consumer: Consumer;
  messages: KafkaMessages;
  timeOfSubscription: number; // unix timestamp (Date.now())
  topic: string;
};

export type KafkaMessages = (Omit<KafkaMessage, 'value'> & { value?: string })[];

export type ProduceParams = SubscribeParams & {
  message: string | object;
};

export type ProduceOptions = SubscribeOptions & {
  encode?: EncodeSchemaOptions;
};

export type SubscribeParams = {
  brokers: string[];
  topic: string;
};

export type SubscribeOptions = Pick<KafkaConfig, 'sasl' | 'ssl'>;

export type ConsumeParams = {
  id: UUID | string;
}

export type ConsumeOptions = {
  multiple?: number;
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
