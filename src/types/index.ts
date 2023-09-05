import { UUID } from 'crypto';

import { Consumer, KafkaConfig, KafkaMessage } from 'kafkajs';

export type Connections = {
  [id: string]: Subscriber;
};

export type Subscriber = {
  consumer: Consumer;
  messages: ConsumedMessage[];
  timeOfSubscription: number; // unix timestamp (Date.now())
  topic: string;
};

export type KafkaMessages = (Omit<KafkaMessage, 'value'> & { value?: string })[];

export type ProduceParams = SubscribeParams & {
  message: ProduceMessage;
};

export type ProduceMessage = {
  headers?: { [key: string]: string };
  key?: string;
  value: Convertable;
};

export type Primitive = string | number | boolean;

export const isPrimitive = (obj: unknown): obj is Primitive => Object(obj) !== obj;

export type Convertable = { [key: string]: unknown } | Primitive | null | undefined | Convertable[];

export type ProduceOptions = SubscribeOptions & {
  conversions?: ConvertOption[];
  encode?: EncodeSchemaOptions;
};

export type ConvertOption = {
  key: string;
  type: ConvertType;
};

export enum ConvertType {
  BYTES = 'bytes',
  DECIMAL = 'decimal',
}

export type SubscribeParams = {
  brokers: string[];
  topic: string;
};

export type SubscribeOptions = Pick<KafkaConfig, 'sasl' | 'ssl'>;

export type ConsumeParams = {
  id: UUID | string;
};

export type ConsumeOptions = {
  multiple?: number;
  regexFilter?: string;
  text?: string; // 'true', 'false', 'TRUE', 'FALSE', 'True', 'False', '1', '0'
  timeout?: number; /** in seconds */
};

export type ConsumedMessage = {
  headers?: { [key: string]: string | undefined };
  key?: string | null;
  value: string;
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
