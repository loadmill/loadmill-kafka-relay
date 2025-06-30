import { UUID } from 'crypto';

import { IHeaders, KafkaConfig, KafkaMessage } from 'kafkajs';

export type KafkaMessages = (Omit<KafkaMessage, 'value'> & { value?: string })[];

export type ProduceParams = SubscribeParams & {
  message: ProduceMessage;
};

export type ProduceMessage = {
  headers: ProduceMessageHeaders;
  key?: string;
  value: Convertable;
};

export type ProduceMessageHeaders = IHeaders | {
  [key: string]: Buffer | string | (Buffer | string)[] | undefined | object;
};

export type Primitive = string | number | boolean;

export const isPrimitive = (obj: unknown): obj is Primitive => Object(obj) !== obj;

export type Convertable = { [key: string]: unknown } | Primitive | null | undefined | Convertable[];

export type ProduceOptions = SubscribeOptions & {
  conversions?: ConvertOption[];
  encode?: EncodeProduceOptions;
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

export type SubscribeOptions = Pick<KafkaConfig, 'sasl' | 'ssl'> & {
  timestamp?: number;
};

export type ConsumeParams = {
  id: UUID | string;
};

export type ConsumeOptions = {
  headerValueRegexFilter?: string;
  multiple?: number;
  regexFilter?: string;
  text?: string; // 'true', 'false', 'TRUE', 'FALSE', 'True', 'False', '1', '0'
  timeout?: number; /** in seconds */
};

export type ConsumedMessage = {
  headers?: { [key: string]: string | undefined };
  key?: string | null;
  timestamp: string;
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

export type EncodeHeaderOptions = {
  [key: string]: EncodeSchemaOptions;
};

export type EncodeProduceOptions = {
  headers?: EncodeHeaderOptions;
  value?: EncodeSchemaOptions;
};
