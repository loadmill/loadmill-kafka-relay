import { UUID } from "crypto";
import { Consumer, KafkaConfig } from "kafkajs";

export type Connections = {
  [id: string]: Subscriber;
};

export type Subscriber = {
  consumer: Consumer;
  messages: string[];
  topic: string;
  timeOfSubscription: number; // unix timestamp (Date.now())
};

export type ProduceOptions = SubscribeOptions & {
  message: string | object;
  encode?: EncodeSchemaOptions;
};

export type SubscribeOptions = Pick<KafkaConfig, 'sasl' | 'ssl'> & {
  brokers: string[];
  topic: string;
};

export type ConsumeOptions = {
  id: UUID;
  regexFilter?: string;
};

export type RegistryOptions = {
  url: string;
  auth?: {
    username: string;
    password: string;
  };
  encode?: EncodeSchemaOptions;
};

export type EncodeSchemaOptions = {
  subject: string;
  version?: number;
};
