# External Integrations

**Analysis Date:** 2026-02-18

## APIs & External Services

**Kafka:**
- Apache Kafka brokers - Produce/consume messages for testing/debugging
  - Client/SDK: `@confluentinc/kafka-javascript` (KafkaJS-compatible) used in `src/kafka/subscribers/subscriber.ts` and `src/kafka/produce.ts`
  - Auth: Kafka SASL/SSL parameters provided per request body to `/subscribe` and `/produce` (`src/router.ts`, schema in `src/server-validation/index.ts`)
  - Broker credential substitution (query params): `KAFKA_BROKER_USERNAME`, `KAFKA_BROKER_PASSWORD` (`src/kafka/brokers.ts`)

**Confluent Schema Registry:**
- Confluent Schema Registry - Encode/Decode Avro payloads
  - SDK/Client: `@kafkajs/confluent-schema-registry` in `src/kafka/schema-registry/index.ts`
  - Auth:
    - Via env vars on startup: `LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME`, `LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD` (`src/kafka/schema-registry/index.ts`)
    - Or via request body to `POST /registry` (`src/router.ts`, `src/server-validation/index.ts`)
  - Base URL:
    - Via env var: `LOADMILL_KAFKA_SCHEMA_REGISTRY_URL` (`src/kafka/schema-registry/index.ts`)
    - Or via request body to `POST /registry` (`src/router.ts`)

## Data Storage

**Databases:**
- Not detected (no SQL/NoSQL database integration present)

**File Storage:**
- Local filesystem only - logs appended to `${APP_NAME}.log` via `fs.createWriteStream` in `src/log/pino-logger.ts`

**Caching / Shared State:**
- Redis - used as shared state store for multi-instance mode, and for pub/sub takeover coordination
  - Connection: `REDIS_URL` (`src/redis/redis-client.ts`, `src/multi-instance/is-multi-instance.ts`)
  - Client: `redis` package (`src/redis/redis-client.ts`)
  - TLS setting: `REDIS_TLS_REJECT_UNAUTHORIZED` (`src/redis/redis-client.ts`)
  - Retry configuration: `REDIS_CONNECT_RETRIES` (`src/redis/constants.ts`)

## Authentication & Identity

**Auth Provider:**
- Not applicable (this service exposes unauthenticated HTTP endpoints in `src/router.ts`)

**Integration Auth Mechanisms:**
- Kafka SASL/SSL options passed at request-time (`src/router.ts`, `src/server-validation/index.ts`)
- Schema Registry basic auth supported via env vars or request body (`src/kafka/schema-registry/index.ts`, `src/router.ts`)

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry/Datadog/etc)

**Logs:**
- Pino structured logging with console + file streams (`src/log/pino-logger.ts`)
- Diagnostics logging (periodic, multi-instance only): gated by `MULTI_INSTANCE_DIAGNOSTICS_LOGGING` in `src/diagnostics/periodic-diagnostics.ts`

## CI/CD & Deployment

**Hosting:**
- Docker container supported (`Dockerfile`)
- Published image referenced in docs: `loadmill/kafka-relay:latest` (`README.md`)

**CI Pipeline:**
- Not detected (no GitHub Actions workflows under `.github/workflows/`)

## Environment Configuration

**Required env vars:**
- None strictly required to start (defaults exist), but common/feature-gated variables include:
  - `LOADMILL_KAFKA_SERVER_PORT` (optional; defaults to 3000) (`src/router.ts`)
  - `CONNECTION_TIMEOUT` (optional; defaults to 1000ms) (`src/kafka/connection-timeout.ts`)
  - `REDIS_URL` (required for multi-instance mode) (`src/multi-instance/is-multi-instance.ts`, `src/redis/redis-client.ts`)
  - Schema registry auto-init (optional): `LOADMILL_KAFKA_SCHEMA_REGISTRY_URL` (+ optional auth and encode vars) (`src/kafka/schema-registry/index.ts`)
  - Logging (optional): `NODE_ENV`, `LOG_LEVEL` (`src/log/pino-logger.ts`)

**Secrets location:**
- Environment variables (loaded from `.env` via `dotenv/config` in `src/on-start-app.ts`)
- Request body env injection supports `<ENV_VAR>` replacement (`src/inject-env/index.ts`)

## Webhooks & Callbacks

**Incoming:**
- None (service exposes synchronous HTTP API endpoints only; routes in `src/router.ts`)

**Outgoing:**
- None (no outbound webhooks; outbound connections are Kafka/Schema Registry/Redis)

---

*Integration audit: 2026-02-18*
