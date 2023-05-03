import qs from 'qs';
import * as URI from 'uri-js';

export const prepareBrokers = (brokers: string[]) => {
  return brokers.map(handleUsernamePassword);
};

const handleUsernamePassword = (broker: string) => {
  const parsedBroker = URI.parse(broker);
  if (parsedBroker.query) {
    const query = qs.parse(parsedBroker.query || '');
    for (const [key, value] of Object.entries(query)) {
      if (key.includes('username')) {
        query[key] = process.env.KAFKA_BROKER_USERNAME || value;
      }
      if (key.includes('password')) {
        query[key] = process.env.KAFKA_BROKER_PASSWORD || value;
      }
    }
    parsedBroker.query = qs.stringify(query);
  }
  return URI.serialize(parsedBroker);
};
