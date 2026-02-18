# Architecture

**Analysis Date:** 2026-02-18

## Pattern Overview

**Overall:** HTTP API (Fastify) as a thin transport layer over a set of module-level “service” functions, with an in-memory or Redis-backed subscription store selected at runtime.

**Key Characteristics:**
- Single process entrypoint that bootstraps diagnostics, optional multi-instance coordination, then starts the HTTP server (`src/index.ts`, `src/on-start-app.ts`, `src/router.ts`).
- “Use-case” functions live under `src/kafka/*` and are called directly from route handlers (no separate controller/service folders).
- Subscription persistence is an interchangeable abstraction (`SubscribersManager` vs `RedisSubscribersManager`) chosen via `REDIS_URL` (`src/kafka/subscribers/subscribers-manager-factory.ts`, `src/multi-instance/is-multi-instance.ts`).

## Layers

**Transport (HTTP):**
- Purpose: Expose endpoints and map request/response to internal types.
- Location: `src/router.ts`
- Contains: Fastify instance, routes, preValidation hooks, schema binding, error handler wiring.
- Depends on: `src/kafka/*` modules, `src/server-validation/*`, `src/server-errors/*`, `src/inject-env/*`, `src/diagnostics/*`.
- Used by: Application runtime via side-effect import in `src/index.ts`.

**Validation:**
- Purpose: Define and compile request schemas (Ajv) used by Fastify.
- Location: `src/server-validation/index.ts`, `src/server-validation/compilation.ts`
- Contains: JSON-schema-like `FastifySchema` objects and a custom `setValidatorCompiler`.
- Depends on: `ajv`, `ajv-errors`, `ajv-formats`.
- Used by: `src/router.ts` (route `schema` and `app.setValidatorCompiler(compile)`).

**Use-cases / Domain logic (Kafka operations):**
- Purpose: Implement Kafka subscribe/consume/produce and schema-registry behavior.
- Location: `src/kafka/*.ts`, `src/kafka/schema-registry/index.ts`, `src/kafka/subscribers/*`
- Contains: High-level operations (`subscribe`, `consume`, `produceMessage`) and subscriber lifecycle.
- Depends on: Kafka client wrapper types (`src/types/kafkajs-confluent.ts`), shared types (`src/types/index.ts`), logging (`src/log/*`), errors (`src/errors/*`).
- Used by: `src/router.ts` route handlers.

**State management (Subscribers):**
- Purpose: Keep track of subscriptions and collected messages.
- Location: `src/kafka/subscribers/*`
- Contains:
  - Base in-memory manager: `src/kafka/subscribers/subscribers-manager.ts`
  - Redis-backed manager + cross-instance behaviors: `src/kafka/subscribers/redis-subscribers-manager.ts`
  - Subscriber implementations: `src/kafka/subscribers/subscriber.ts`, `src/kafka/subscribers/redis-subscriber.ts`
  - Serialization/Redis key conventions: `src/kafka/subscribers/redis-keys.ts`, `src/kafka/subscribers/serialized-subscriber.ts`
- Depends on: Redis clients (`src/redis/redis-client.ts`), multi-instance identity (`src/multi-instance/relay-instance-id.ts`).
- Used by: `src/kafka/subscribe.ts`, `src/kafka/consume.ts`, `src/router.ts` (unsubscribe, existence checks), diagnostics (`src/diagnostics/*`).

**Infrastructure adapters:**
- Purpose: Encapsulate external client creation and cross-cutting concerns.
- Location:
  - Redis: `src/redis/redis-client.ts`, `src/redis/constants.ts`, `src/redis/types.ts`
  - Logging: `src/log/index.ts`, `src/log/pino-logger.ts`, `src/log/kafka-pino-adapter.ts`, `src/log/types.ts`
  - Error mapping: `src/server-errors/index.ts`, `src/errors/index.ts`
- Used by: Most modules via direct imports.

**Multi-instance coordination:**
- Purpose: Coordinate takeovers between instances and clean shutdown in Redis mode.
- Location: `src/multi-instance/*`
- Contains: instance registration, shutdown announcement/subscription, signal handlers.
- Depends on: Redis clients (`src/redis/redis-client.ts`), subscriber takeover (`src/kafka/subscribers/index.ts`).
- Used by: App bootstrap (`src/on-start-app.ts`).

## Data Flow

**HTTP Subscribe Flow (`POST /subscribe`):**

1. Request enters Fastify route in `src/router.ts`.
2. `preValidation: injectEnvVars` replaces `<ENV_VAR>` placeholders inside the body (`src/inject-env/index.ts`).
3. Body validated using `subscribeValidationSchema` (`src/server-validation/index.ts`) compiled by `compile` (`src/server-validation/compilation.ts`).
4. Handler calls `subscribe()` (`src/kafka/subscribe.ts`).
5. `subscribe()` calls `addSubscriber` from `src/kafka/subscribers/index.ts`, which delegates to the singleton manager from `src/kafka/subscribers/subscribers-manager-factory.ts`.
6. Manager creates a `Subscriber` (`src/kafka/subscribers/subscriber.ts`) or `RedisSubscriber` (`src/kafka/subscribers/redis-subscriber.ts`) depending on `isMultiInstance()` (`src/multi-instance/is-multi-instance.ts`).
7. Subscriber connects to Kafka, starts consuming, and seeks to offsets inferred from timestamp (`src/kafka/subscribers/subscriber.ts`).
8. Route returns `{ id }`.

**HTTP Consume Flow (`GET /consume/:id`):**

1. Request enters `src/router.ts` and query/params schema is validated using `consumeValidationSchema` (`src/server-validation/index.ts`).
2. Route checks `isSubscriberExists(id)` (`src/kafka/subscribers/index.ts`).
3. Handler calls `consume({ id }, options)` (`src/kafka/consume.ts`).
4. `consume()` polls `getMessages(id)` (`src/kafka/subscribers/index.ts`) until a match is found or timeout is exceeded.
5. Filtering is applied via `filterMessages()` with optional regex and header-regex (`src/kafka/consume.ts`).
6. If `text` query option is falsy, `consume()` attempts to JSON-parse each message value (`src/kafka/consume.ts`).
7. Response returns `{ messages }`.

**Kafka Message Capture (subscriber side effect):**

1. Kafka consumer `eachMessage` calls `Subscriber.addMessage()` (`src/kafka/subscribers/subscriber.ts`).
2. Message is converted to `ConsumedMessage` via `fromKafkaToConsumedMessage()` (`src/kafka/subscribers/messages.ts`).
3. Value/headers attempt schema-registry decode first (`src/kafka/schema-registry/index.ts`), then fall back to `.toString()`.
4. In Redis mode, `RedisSubscriber.addMessage()` persists messages to Redis list and sets TTL (`src/kafka/subscribers/redis-subscriber.ts`).

**HTTP Produce Flow (`POST /produce`):**

1. Request enters `src/router.ts` with `preValidation: injectEnvVars` and `produceValidationSchema` (`src/server-validation/index.ts`).
2. Handler calls `produceMessage()` (`src/kafka/produce.ts`).
3. `produceMessage()` creates a Kafka producer per-request, connects, sends, then disconnects (`src/kafka/produce.ts`).
4. Optional conversions are applied by mutating the message (`src/kafka/convert.ts`, `src/kafka/deep-modify-object.ts`).
5. Optional schema-registry encoding is applied to headers/value (`src/kafka/encode-headers.ts`, `src/kafka/schema-registry/index.ts`).
6. Response returns `RecordMetadata`.

**Schema Registry Flow (`POST /registry`, `PUT /registry/encode`):**

1. Requests enter `src/router.ts` with env injection + schema validation (`registryValidationSchema`, `encodeValidationSchema` in `src/server-validation/index.ts`).
2. Handler calls `initSchemaRegistry()` or `setEncodeSchema()` (`src/kafka/schema-registry/index.ts`).
3. `schemaRegistry` client and `activeSchemaId` are stored in module-level state (`src/kafka/schema-registry/index.ts`).
4. Subsequent decode/encode operations used by subscriber capture and producer encoding read this module state.

**State Management:**
- Subscriber identity is a UUID used as both API subscription id and Kafka groupId (`src/kafka/subscribers/subscriber.ts`).
- In single-instance mode, messages and subscribers are stored in memory (`src/kafka/subscribers/subscribers-manager.ts`).
- In multi-instance mode, subscriber metadata and messages are stored in Redis (keys via `src/kafka/subscribers/redis-keys.ts`, TTL constants in `src/kafka/subscribers/constants.ts`).

## Key Abstractions

**SubscribersManager (state backend abstraction):**
- Purpose: Provide a common API for creating/removing subscribers and reading messages.
- Examples: `src/kafka/subscribers/subscribers-manager.ts`, `src/kafka/subscribers/redis-subscribers-manager.ts`
- Pattern: Runtime-selected singleton factory (`src/kafka/subscribers/subscribers-manager-factory.ts`).

**Subscriber (Kafka consumer wrapper):**
- Purpose: Own a Kafka consumer, track subscription metadata, and collect messages.
- Examples: `src/kafka/subscribers/subscriber.ts`, `src/kafka/subscribers/redis-subscriber.ts`
- Pattern: Base class + Redis specialization overriding storage methods.

**Schema Registry adapter:**
- Purpose: Provide encode/decode helpers with optional global “active schema”.
- Examples: `src/kafka/schema-registry/index.ts`
- Pattern: Module-scoped singleton state (`schemaRegistry`, `activeSchemaId`, `latestUrl`).

**Env var injection for request bodies:**
- Purpose: Allow request bodies to reference process env values using `<NAME>` placeholders.
- Examples: `src/inject-env/index.ts`
- Pattern: Fastify `preValidation` hook.

## Entry Points

**Application bootstrap:**
- Location: `src/index.ts`
- Triggers: Node runtime (`yarn dev` runs `src/index.ts`, `yarn start` runs `dist` per `package.json`).
- Responsibilities: Side-effect imports to initialize startup logic and server (`import './on-start-app'`, `import './router'`).

**Startup initialization:**
- Location: `src/on-start-app.ts`
- Triggers: Imported by `src/index.ts`.
- Responsibilities:
  - Load dotenv (`import 'dotenv/config'`).
  - Register diagnostics and crash/exit handlers (`src/diagnostics/*`).
  - Initialize multi-instance behavior when `REDIS_URL` is set (`src/multi-instance/*`).
  - Optionally initialize schema registry from env on startup (`handleKafkaRegistryEnvVars()` in `src/kafka/schema-registry/index.ts`).

**HTTP server:**
- Location: `src/router.ts`
- Triggers: Imported by `src/index.ts`.
- Responsibilities:
  - Create Fastify server with `pinoLogger` (`src/log/pino-logger.ts`).
  - Register routes: `/`, `/subscribe`, `/subscriptions/:id`, `/consume/:id`, `/produce`, `/registry`, `/registry/encode`, `/debug`.
  - Wire schema compiler (`src/server-validation/compilation.ts`) and error handler (`src/server-errors/index.ts`).
  - Listen on `LOADMILL_KAFKA_SERVER_PORT` (defaults to 3000).

## Error Handling

**Strategy:** Central Fastify error handler maps common internal/external error types to HTTP status codes and a presentable body.

**Patterns:**
- Throw `ClientError(status, message)` for expected client-facing failures (`src/errors/index.ts`; used in `src/router.ts`, `src/kafka/consume.ts`, `src/kafka/schema-registry/index.ts`, `src/kafka/convert.ts`).
- Use `app.setErrorHandler(serverErrorHandler)` to standardize output (`src/router.ts`, `src/server-errors/index.ts`).
- Kafka/Schema-registry errors are detected and translated to 400 where possible (`src/server-errors/index.ts`, `src/types/kafkajs-confluent.ts`).

## Cross-Cutting Concerns

**Logging:** `pino` multi-stream to console and file (`src/log/pino-logger.ts`), wrapped to match KafkaJS logger expectations (`src/log/kafka-pino-adapter.ts`, `src/log/index.ts`).

**Validation:** Fastify schemas in `src/server-validation/index.ts` compiled via Ajv compiler `src/server-validation/compilation.ts`.

**Authentication:** Not applicable (no auth layer detected in routes).

---

*Architecture analysis: 2026-02-18*
