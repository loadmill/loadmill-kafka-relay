import { randomUUID } from 'crypto';

import { Consumer, EachMessagePayload, Kafka, KafkaConfig, PartitionOffset } from 'kafkajs';

import { APP_NAME } from '../../constants';
import { ConsumedMessage, SubscribeOptions, SubscribeParams } from '../../types';
import { prepareBrokers } from '../brokers';
import { kafkaLogCreator } from '../log-creator';

import { fromKafkaToConsumedMessage } from './messages';

export class Subscriber {
  consumer: Consumer;
  id: string;
  kafka: Kafka;
  kafkaConfig: { brokers: string[] } & Pick<KafkaConfig, 'connectionTimeout' | 'sasl' | 'ssl'>;
  protected messages: ConsumedMessage[] = [];
  timeOfSubscription: number;
  topic: string;

  constructor(
    { brokers, topic }: SubscribeParams,
    { connectionTimeout, sasl, ssl }: SubscribeOptions,
    id?: string,
  ) {
    this.timeOfSubscription = Date.now();
    this.topic = topic;
    this.kafkaConfig = { brokers, connectionTimeout, sasl, ssl };
    this.kafka = new Kafka({
      brokers: prepareBrokers(brokers),
      clientId: APP_NAME,
      connectionTimeout,
      logCreator: kafkaLogCreator,
      sasl,
      ssl,
    });
    this.id = id || randomUUID();
    this.consumer = this.kafka.consumer({ groupId: this.id });
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
    await this.consumer.subscribe({ fromBeginning: false, topic: this.topic });
    await this.consumer.run({
      eachMessage: async (payload) => {
        await this.addMessage(payload);
      },
    });
    await assignPartitions(this.consumer, partitions, this.topic);
  }
}

const getPartitionsByTimestamp = async (
  kafka: Kafka,
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
