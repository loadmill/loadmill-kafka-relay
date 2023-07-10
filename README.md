# Loadmill Kafka Relay Client

The [Loadmill](https://loadmill.com) Kafka Relay is a powerful Kafka client that allows you to produce and consume messages from Kafka topics easily. It provides a set of APIs to interact with Kafka brokers, manage message production, consumption, and schema registry operations.
It was built to help you test your Kafka infrastructure and applications, and to make it easier to debug and troubleshoot Kafka-related issues.

## Table of Contents
- [Getting Started](#getting-started)
  - [Docker](#docker)
    - [Docker hub](#docker-hub)
    - [Local Docker Build](#local-docker-build)
  - [Node.js](#nodejs)
- [API Reference](#api-reference)
  - [Basic Usage](#basic-usage)
    - [Subscribe to a Topic](#subscribe-to-a-topic)
    - [Consume Messages](#consume-messages)
  - [Advanced Usage](#advanced-usage)
    - [Produce a Message](#produce-a-message)
    - [Schema Registry](#schema-registry)
      - [Setting a Schema Registry](#setting-a-schema-registry)
      - [Set Encode Schema](#set-encode-schema)
  - [Environment Variables](#environment-variables)
    - [Why Environment Variables?](#why-environment-variables)
    - [How to Use Env Vars Here?](#how-to-use-env-vars-here)
    - [Env Var Names Used in This App](#env-var-names-used-in-this-app)



## Getting Started

To use the Loadmill Kafka Relay Client, you have 2 options:

**Option 1:**
### Docker

The Loadmill Kafka Relay Client is available as a Docker image, which you either pull from Docker Hub or build locally.

### Docker hub
To use the ready-made docker from docker-hub run the following commands:
- Download the image
```bash
docker pull loadmill/kafka-relay:latest
```
- Run the image
```bash
docker run -p 3000:3000 loadmill/kafka-relay 
```

OR you can build the image locally, in the following way:
### Local Docker Build
- Build the image:
```bash
docker build -t loadmill/kafka-relay .
```
- Run the image:
```bash
docker run -p 3000:3000 loadmill/kafka-relay
```

Option 2:
### Node.js

You can fork/clone this repository and run the Kafka Relay Client locally using Node.js.

```bash
git clone git@github.com:loadmill/loadmill-kafka-relay.git
```
```bash
cd loadmill-kafka-relay
```
```bash
npm install # or yarn install
```
```bash
npm run build # or yarn build
```
```bash
npm run start # or yarn start
```

## API Reference

The Loadmill Kafka Relay Client provides the following API endpoints for interacting with Kafka. You can make HTTP requests to these endpoints to perform various actions.

### Basic Usage

### Subscribe to a Topic

Endpoint: `POST /subscribe`

To subscribe to a Kafka topic and start receiving messages, send a POST request to the `/subscribe` endpoint with the following parameters in the request body:

- Required parameters:
  - `brokers` (array of strings): The list of Kafka brokers.
  - `topic` (string): The Kafka topic to subscribe to.
- Optional parameters:
  - `ssl` (boolean, optional): Whether to use SSL for the Kafka brokers.
  - `sasl` (object, optional): SASL authentication credentials for the Kafka brokers.
    - `mechanism` (string): The SASL mechanism to use for authentication.
    - `username` (string): The username for authentication.
    - `password` (string): The password for authentication.

Example Request:
```http
POST /subscribe
Content-Type: application/json
```
```json
{
  "brokers": ["kafka1.example.com:9092", "kafka2.example.com:9092"],
  "topic": "my-topic"
}
```

Example Response:
```json
{
  "id": "c8bf8b9b-5bb6-4f17-babd-3d027eb7ad55"
}
```

Use the `id` field in the response to consume messages from the subscribed Kafka topic, with the `/consume/:id` endpoint.

### Consume Messages

Endpoint: `GET /consume/:id`

To consume messages from a subscribed Kafka topic, send a GET request to the `/consume/:id` endpoint, where `:id` represents the unique identifier of the subscription.
The default result will be the latest message on the topic.

If no message is available, the relay waits for 1 second and tries to consume again. If no message is available after 25 seconds (or a provided `timeout` value), an error will be returned.

Optional query parameters:
- `filter` (string, optional): A regular expression to filter the topic's messages by.
- `multiple` (number, optional): The number of messages to consume. Will return the latest `multiple` messages. Minimum value is 1, maximum value is 10. Defaults to 1.
- `timeout` (number, optional): The maximum time (in seconds) to wait for a message to be available. If no message is available after the timeout, an error will be returned. Minimum value is 5, maximum value is 25. Defaults to 25.
- `text` (boolean, optional): Whether to return the message value as a string (and not parse it as JSON). Defaults to false.

Example Request 1:
```http
GET /consume/c8bf8b9b-5bb6-4f17-babd-3d027eb7ad55
```

Example Response 1:
```json
{
  "messages": [
    {
      "key": "my-key",
      "value": "Hello, Kafka!",
      "timestamp": 1623346800000,
      ...
    }
  ]
}
```

Example Request 2 (using a regex filter):
```http
GET /consume/c8bf8b9b-5bb6-4f17-babd-3d027eb7ad55?filter=myregex
```

Example Request 3 (using a timeout):
```http
GET /consume/c8bf8b9b-5bb6-4f17-babd-3d027eb7ad55?filter=myregex&timeout=7
```

Example Request 4 (using multiple messages option):
```http
GET /consume/c8bf8b9b-5bb6-4f17-babd-3d027eb7ad55?multiple=2
```

Example Response 4 (using multiple messages option):
```json
{
  "messages": [
    {
      "key": "my-key-1",
      "value": "Hello, Kafka 1!",
      "timestamp": 1623346800000,
      ...
    },
    {
      "key": "my-key-2",
      "value": "Hello, Kafka 2!",
      "timestamp": 1623346800001,
      ...
    }
  ]
}
```

#### Compression codecs
To turn on LZ4 compression codec decoding on message consuming add the following environemt variable:
```bash
LOADMILL_KAFKA_LZ4_COMPRESSION_CODEC='true'
```

### Advanced Usage

### Produce a Message

Endpoint: `POST /produce`

To produce a message to a Kafka topic, send a POST request to the `/produce` endpoint with the following parameters in the request body:

- Required Parameters:
  - `brokers` (array of strings): The list of Kafka brokers.
  - `topic` (string): The Kafka topic to which the message will be produced.
  - `message` (string or object): The message to be produced.
- Optional Parameters:
  - `convertions` (array, optional): Options for certain keys inside the message. Each item in the array should be an object with the following keys:
    - `key` (string): The key to convert.
    - `type` (string): The type to convert the key to. Can be one of the following: `decimal`, (currently only supports `decimal`).
  - `encode` (object, optional): Options for schema encoding.
    - `subject` (string): The subject of the schema.
    - `version` (number, optional): The version of the schema.
  - `ssl` (boolean, optional): Whether to use SSL for the Kafka brokers.
  - `sasl` (object, optional): SASL authentication credentials for the Kafka brokers.
    - `mechanism` (string): The SASL mechanism to use for authentication.
    - `username` (string): The username for authentication.
    - `password` (string): The password for authentication.

Note: Using `encode` will only apply your encoding to the current message.
It will not override the global encode (this is set via the [/registry/encode](#set-encode-schema) endpoint).

Example Request:
```http
POST /produce
Content-Type: application/json
```
```json
{
  // required parameters
  "brokers": ["kafka1.example.com:9092", "kafka2.example.com:9092"],
  "topic": "my-topic",
  "message": "Hello, Kafka!",
  // optional parameters
  "convertions": [
    {
      "key": "my-key",
      "type": "decimal"
    }
  ],
  "encode": {
    "subject": "my-schema",
    "version": 1
  },
  "ssl": true,
  "sasl": {
    "mechanism": "plain",
    "username": "user",
    "password": "password"
  }
}
```

### Schema Registry

#### Setting a Schema Registry

You may use the following env vars to connect to a schema registry on the app startup:
```bash
# Minimal configuration for decoding messages:
LOADMILL_KAFKA_SCHEMA_REGISTRY_URL= # The URL of the Schema Registry
# For encoding messages add this var:
LOADMILL_KAFKA_SCHEMA_SUBJECT= # The subject of the schema
# Optional configuration
LOADMILL_KAFKA_SCHEMA_VERSION= # The version of the schema
LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME= # The username for authentication
LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD= # The password for authentication
```

Another option is to use the following endpoint to set (connect to) a Schema Registry:

Endpoint: `POST /registry`

To initialize the Schema Registry for your Kafka environment, send a POST request to the `/registry` endpoint with the following parameters in the request body:

- Required parameters:
  - `url` (string): The URL of the Schema Registry.
- Optional parameters:
  - `auth` (object, optional): Authentication credentials for the Schema Registry.
    - `username` (string): The username for authentication.
    - `password` (string): The password for authentication.
  - `encode` (object, optional): Options for schema encoding.
    - `subject` (string): The subject of the schema.
    - `version` (number, optional): The version of the schema.

Note: that the optional `encode` option is used to set the encode schema for the Schema Registry. **If you don't provide this option, messages will not be encoded.**

Example Request:
```http
POST /registry
Content-Type: application/json
```
```json
{
  "url": "https://schema-registry.example.com",
  "auth": {
    "username": "user",
    "password": "password"
  },
  "encode": {
    "subject": "my-schema",
    "version": 1
  }
}
```

#### Set Encode Schema

Endpoint: `PUT /registry/encode`

This endpoint is useful when you want to encode your produced message according to a specific schema, or want to update the current encode schema that is set for the Schema Registry.

Note 1: Before you call this endpoint, you must initialize the Schema Registry using the `/registry` endpoint.
Note 2: Changing the encode schema will affect all future produced messages.

To set the encode schema for the Schema Registry, send a PUT request to the `/registry/encode` endpoint with the following parameters in the request body:

- Required parameters:
  - `subject` (string): The subject of the schema.
- Optional parameters:
  - `version` (number, optional): The version of the schema. (If not provided, the latest version will be used.)

Example Request:
```http
PUT /registry/encode
Content-Type: application/json
```
```json
{
  "subject": "my-schema",
  "version": 1
}
```

### Environment Variables

### Why Environment Variables?

The main advantage of using environment variables is security. You can store sensitive information like passwords and private urls in environment variables, and then use them in your requests without exposing them in your code.

### How to Use Env Vars Here?

If you pass a value in the request body that looks like this:
`<VAR_NAME>`
the Loadmill Kafka Relay Client will try to replace it with the value of the corresponding environment variable.

Note: You can use **any name you want**, as long as it matches the name of an environment variable.

Example:
Assuming the following environment variables are defined:
```bash
BROKERS=kafka1.example.com:9092,kafka2.example.com:9092
TOPIC=my-topic
SSL=true
MECHANISM=plain
USERNAME=user
PASSWORD=password
```

Then you can send the following request to the `/subscribe` endpoint:

```http
POST /subscribe
```
```json
{
  "brokers": "<BROKERS>",
  "topic": "<TOPIC>",
  "ssl": "<SSL>",
  "sasl": {
    "mechanism": "<MECHANISM>",
    "username": "<USERNAME>",
    "password": "<PASSWORD>"
  }
}
```

And the server will receive the following request body:

```http
POST /subscribe
```
```json
{
  "brokers": ["kafka1.example.com:9092", "kafka2.example.com:9092"],
  "topic": "my-topic",
  "ssl": true,
  "sasl": {
    "mechanism": "plain",
    "username": "user",
    "password": "password"
  }
}
```

This example uses the `/subscribe` call, but the env var replacement will work for all endpoints.

NOTE: `"brokers"` key is converted to an array, so the string value of the env var will be split by commas (`,`).

To recap:
`<FOO>` -> `process.env.FOO`

Meaning, any value in the request body using the `<` `BAR` `>` syntax will be replaced with the corresponding environment variable, specifically `process.env.BAR`.

### Env Var Names Used in This App

You may use the following environment variables in this app:

```bash
LOADMILL_KAFKA_SERVER_PORT= # The port on which the server will listen, defaults to 3000
```
