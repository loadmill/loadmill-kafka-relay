import { randomUUID } from 'crypto';

import {
  Consumer,
  EachMessagePayload,
  KafkaConfig,
  PartitionOffset,
} from '@confluentinc/kafka-javascript/types/kafkajs';

import { APP_NAME } from '../../constants';
import log from '../../log';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';
import { Kafka, KafkaType } from '../../types/kafkajs-confluent';
import { prepareBrokers } from '../brokers';

import { fromKafkaToConsumedMessage } from './messages';

export class Subscriber {
  consumer: Consumer;
  id: string;
  kafka: KafkaType;
  kafkaConfig: { brokers: string[] } & Pick<KafkaConfig, 'connectionTimeout' | 'sasl' | 'ssl'>;
  protected messages: ConsumedMessage[] = [];
  timeOfSubscription: number;
  topic: string;

  constructor(
    { brokers, topic }: SubscribeParams,
    { connectionTimeout, sasl, ssl = false }: SubscribeOptions,
    id?: string,
    groupIdOverride?: string,
  ) {
    this.timeOfSubscription = Date.now();
    this.topic = topic;
    this.kafkaConfig = { brokers, connectionTimeout, sasl, ssl };
    this.kafka = new Kafka({
      kafkaJS: {
        brokers: prepareBrokers(brokers),
        clientId: APP_NAME,
        connectionTimeout,
        logger: log,
        ...(sasl && { sasl }),
        ssl,
      },
    });
    this.id = id || randomUUID();
    const groupId = groupIdOverride || this.id;
    this.consumer = this.kafka.consumer({ kafkaJS: { fromBeginning: false, groupId } });
  }

  async addMessage({ message }: EachMessagePayload): Promise<void> {
    this.messages.push(await fromKafkaToConsumedMessage(message));
  }

  async getMessages(): Promise<ConsumedMessage[]> {
    return this.messages;
  }

  async subscribe(timestamp?: number): Promise<void> {
    await this.consumer.connect();
    const partitions = await getPartitionsByTimestamp(this.kafka, this.topic, timestamp);
    await this.consumer.subscribe({ topic: this.topic });
    await this.consumer.run({
      eachMessage: async (payload) => {
        await this.addMessage(payload);
      },
    });
    await assignPartitions(this.consumer, partitions, this.topic);
  }
}

const getPartitionsByTimestamp = async (
  kafka: KafkaType,
  topic: string,
  timestamp = get1MinuteAgoTimestamp(),
): Promise<PartitionOffset[]> => {
  const admin = kafka.admin();
  await admin.connect();
  const partitions = await admin.fetchTopicOffsetsByTimestamp(topic, timestamp);
  await admin.disconnect();
  return partitions;
};

const get1MinuteAgoTimestamp = () => Date.now() - 60 * 1000;

const assignPartitions = async (consumer: Consumer, partitions: PartitionOffset[], topic: string) => {
  await Promise.all(
    partitions.map(({ partition, offset }) =>
      consumer.seek({ offset, partition, topic }),
    ),
  );
};

export type Subscribers = {
  [id: string]: Subscriber;
};

export type ShallowSubscribers = {
  [id: string]: ShallowSubscriber;
};

export type ShallowSubscriber = Pick<Subscriber, 'timeOfSubscription' | 'topic'> & {
  messages: ConsumedMessage[];
};
