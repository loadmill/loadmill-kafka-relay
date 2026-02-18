# Technology Stack

**Analysis Date:** 2026-02-18

## Languages

**Primary:**
- TypeScript (tsc via `typescript`) - Application source in `src/**/*.ts`

**Secondary:**
- JavaScript - Tooling/config in `jest.config.js`, `.eslintrc.js`
- Dockerfile (container build) - `Dockerfile`

## Runtime

**Environment:**
- Node.js 18 (container base image `node:18.20.5-alpine` in `Dockerfile`; local dev expected to match)

**Package Manager:**
- Yarn (used in `Dockerfile` and scripts in `package.json`)
- Lockfile: present (`yarn.lock`)

## Frameworks

**Core:**
- Fastify `^4.17.0` - HTTP API server in `src/router.ts`

**Testing:**
- Jest `^29.6.1` + ts-jest `^29.1.1` - Unit tests; config in `jest.config.js`

**Build/Dev:**
- TypeScript `^5.0.4` - Compile `src/` → `dist/` (`tsconfig.json`)
- ESLint `^8.43.0` + `@typescript-eslint/*` - Linting (`.eslintrc.js`, `package.json` scripts)
- Nodemon `^2.0.22` + ts-node `^10.9.1` - Dev runtime for TS (`nodemon.json`, `package.json` scripts)

## Key Dependencies

**Critical:**
- `@confluentinc/kafka-javascript` `^1.6.0` - KafkaJS-compatible Kafka client used by consumers/producers (`src/kafka/subscribers/subscriber.ts`, `src/kafka/produce.ts`)
- `@kafkajs/confluent-schema-registry` `^3.3.0` - Confluent Schema Registry client for Avro encode/decode (`src/kafka/schema-registry/index.ts`)
- `redis` `^4.6.15` - Multi-instance state storage and pub/sub coordination (`src/redis/redis-client.ts`, `src/multi-instance/instance-manager.ts`)

**Infrastructure:**
- `pino` `^8.14.1` + `pino-pretty` `^10.0.0` - Structured logging to stdout + file (`src/log/pino-logger.ts`)
- `dotenv` `^16.0.3` - Loads `.env` on startup (`src/on-start-app.ts`)
- `ajv` `^8.12.0` + `ajv-formats` + `ajv-errors` - JSON schema validation (Fastify validator compiler in `src/server-validation/compilation.ts`, schemas in `src/server-validation/index.ts`)
- `avsc` `^5.7.7` + `@ovotech/avro-decimal` + `decimal.js` - Avro decoding/encoding helpers and decimal logical type (`src/kafka/schema-registry/index.ts`, conversion code in `src/kafka/convert.ts`)
- `qs` `^6.11.1` + `uri-js` `^4.4.1` - Broker URI parsing and query manipulation (`src/kafka/brokers.ts`)
- `patch-package` `^8.0.0` - Postinstall patching of dependencies (`package.json`, patch in `patches/avsc+5.7.7.patch`)

## Configuration

**Environment:**
- `.env` is loaded at runtime via `dotenv/config` import in `src/on-start-app.ts`.
- Server port: `LOADMILL_KAFKA_SERVER_PORT` read in `src/router.ts`.
- Kafka client timeout: `CONNECTION_TIMEOUT` read in `src/kafka/connection-timeout.ts` (clamped to 1000–30000ms).
- Kafka broker credential substitution (when broker URIs include query params): `KAFKA_BROKER_USERNAME`, `KAFKA_BROKER_PASSWORD` in `src/kafka/brokers.ts`.
- Schema Registry bootstrap via env vars in `src/kafka/schema-registry/index.ts`:
  - `LOADMILL_KAFKA_SCHEMA_REGISTRY_URL`
  - `LOADMILL_KAFKA_SCHEMA_REGISTRY_USERNAME`
  - `LOADMILL_KAFKA_SCHEMA_REGISTRY_PASSWORD`
  - `LOADMILL_KAFKA_SCHEMA_SUBJECT`
  - `LOADMILL_KAFKA_SCHEMA_VERSION`
- LZ4 decode/produce compression toggle: `LOADMILL_KAFKA_LZ4_COMPRESSION_CODEC` in `src/kafka/compression-codec.ts`.
- Logging:
  - `LOG_LEVEL`, `NODE_ENV` in `src/log/pino-logger.ts`.
  - File log written to `${APP_NAME}.log` (default `loadmill-kafka-relay.log`) in `src/log/pino-logger.ts`.
- Multi-instance/Redis:
  - Enable multi-instance: `REDIS_URL` checked in `src/multi-instance/is-multi-instance.ts`.
  - TLS behavior: `REDIS_TLS_REJECT_UNAUTHORIZED` in `src/redis/redis-client.ts`.
  - Connection retries: `REDIS_CONNECT_RETRIES` in `src/redis/constants.ts`.
  - Periodic diagnostics toggle: `MULTI_INSTANCE_DIAGNOSTICS_LOGGING` in `src/diagnostics/periodic-diagnostics.ts`.
- Request-time env injection: any string value in request bodies can reference env vars via `<ENV_VAR>` replacement in `src/inject-env/index.ts` (special-cases `brokers` to split by commas).

**Build:**
- TypeScript build output: `dist/` configured by `tsconfig.json` (`rootDir: src`, `outDir: dist`, `module: commonjs`, `strict: true`).
- Docker build: `Dockerfile` runs `yarn install` and `yarn build`, then starts `node --no-experimental-fetch dist`.

## Platform Requirements

**Development:**
- Node.js 18.x and Yarn
- Kafka broker(s) reachable from the process (provided per request to `/subscribe` and `/produce` in `src/router.ts`)
- Optional: Redis reachable when using multi-instance mode (`REDIS_URL`)

**Production:**
- Containerized deployment supported via `Dockerfile` (exposes port 3000)
- Optional external dependencies depending on features used:
  - Redis for multi-instance coordination/state (`src/redis/redis-client.ts`, `src/multi-instance/*`)
  - Confluent Schema Registry for Avro encode/decode (`src/kafka/schema-registry/index.ts`)

---

*Stack analysis: 2026-02-18*
