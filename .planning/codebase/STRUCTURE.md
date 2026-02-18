# Codebase Structure

**Analysis Date:** 2026-02-18

## Directory Layout

```
[project-root]/
├── src/                     # TypeScript source code
│   ├── index.ts             # App entrypoint (imports startup + router)
│   ├── on-start-app.ts      # Startup initialization (dotenv, diagnostics, multi-instance)
│   ├── router.ts            # Fastify server + HTTP routes
│   ├── constants.ts         # Global constants (app name, truthy strings)
│   ├── diagnostics/         # Crash/exit hooks + periodic logging
│   ├── errors/              # App-level error types (ClientError)
│   ├── inject-env/          # Fastify preValidation env-var injection
│   ├── kafka/               # Kafka operations (subscribe/consume/produce + helpers)
│   ├── log/                 # Pino logger setup + Kafka logger adapter
│   ├── multi-instance/      # Redis-based multi-instance coordination
│   ├── redis/               # Redis client factory + constants/types
│   ├── server-errors/       # Fastify error handler
│   ├── server-validation/   # Fastify schemas + Ajv compiler
│   └── types/               # Shared TS types + KafkaJS wrapper exports
├── test/                    # Jest tests (TypeScript)
├── dist/                    # Compiled JS output (tsc outDir)
├── patches/                 # patch-package patches
├── Dockerfile               # Container build
├── jest.config.js           # Jest + ts-jest configuration
├── tsconfig.json            # TS compiler options (rootDir src, outDir dist)
├── nodemon.json             # Dev runner configuration
├── package.json             # Scripts and dependencies
└── README.md                # Usage docs and API reference
```

## Directory Purposes

**`src/`**
- Purpose: All application runtime code.
- Contains: Fastify server, Kafka logic, Redis/multi-instance logic, validation, logging.
- Key files: `src/index.ts`, `src/on-start-app.ts`, `src/router.ts`.

**`src/kafka/`**
- Purpose: Kafka-focused use-cases and helpers.
- Contains:
  - HTTP-facing operations: `src/kafka/subscribe.ts`, `src/kafka/consume.ts`, `src/kafka/produce.ts`
  - Helpers: `src/kafka/brokers.ts`, `src/kafka/connection-timeout.ts`, `src/kafka/compression-codec.ts`, `src/kafka/convert.ts`, `src/kafka/deep-modify-object.ts`, `src/kafka/encode-headers.ts`
  - Schema registry adapter: `src/kafka/schema-registry/index.ts`
  - Subscription subsystem: `src/kafka/subscribers/*`
  - Debug data assembly: `src/kafka/debug/index.ts`
- Key files: `src/kafka/subscribers/subscriber.ts`, `src/kafka/subscribers/subscribers-manager.ts`, `src/kafka/subscribers/redis-subscribers-manager.ts`.

**`src/kafka/subscribers/`**
- Purpose: Encapsulate subscription lifecycle and message persistence.
- Contains:
  - Manager interface: `src/kafka/subscribers/subscribers-manager.ts`
  - Redis manager: `src/kafka/subscribers/redis-subscribers-manager.ts`
  - Factory: `src/kafka/subscribers/subscribers-manager-factory.ts`
  - Implementations: `src/kafka/subscribers/subscriber.ts`, `src/kafka/subscribers/redis-subscriber.ts`
  - Redis conventions: `src/kafka/subscribers/redis-keys.ts`, `src/kafka/subscribers/redis-channels.ts`
  - Message conversion/storage: `src/kafka/subscribers/messages.ts`
  - Constants/TTL: `src/kafka/subscribers/constants.ts`
- Key files: `src/kafka/subscribers/index.ts` (exports manager operations).

**`src/multi-instance/`**
- Purpose: Cross-instance coordination and takeover in Redis mode.
- Contains: `src/multi-instance/index.ts`, `src/multi-instance/instance-manager.ts`, `src/multi-instance/shutdown-signal-handlers.ts`, key/channel helpers.

**`src/redis/`**
- Purpose: Central Redis client creation and configuration.
- Contains: `src/redis/redis-client.ts`, `src/redis/constants.ts`, `src/redis/types.ts`.

**`src/server-validation/`**
- Purpose: Central request validation schemas.
- Contains: `src/server-validation/index.ts` (schemas), `src/server-validation/compilation.ts` (Ajv compiler).

**`src/server-errors/`**
- Purpose: Central HTTP error mapping.
- Contains: `src/server-errors/index.ts` (`serverErrorHandler`).

**`src/log/`**
- Purpose: Logging and KafkaJS logger compatibility.
- Contains: `src/log/pino-logger.ts`, `src/log/kafka-pino-adapter.ts`, `src/log/index.ts`.

**`src/diagnostics/`**
- Purpose: Process-level observability utilities.
- Contains: `src/diagnostics/crash-log.ts`, `src/diagnostics/exit-log.ts`, `src/diagnostics/periodic-diagnostics.ts`, `src/diagnostics/endpoint-counters.ts`, `src/diagnostics/memory.ts`.

**`test/`**
- Purpose: Jest test suite.
- Contains: `test/kafka/consume.test.ts`, `test/kafka/convert.test.ts`.

**`dist/`**
- Purpose: Build output emitted by `tsc` (`outDir` in `tsconfig.json`).
- Generated: Yes
- Committed: Yes (present in repo; ignored by Jest via `jest.config.js`).

## Key File Locations

**Entry Points:**
- `src/index.ts`: Main entry; imports `src/on-start-app.ts` and `src/router.ts` for side effects.
- `src/router.ts`: Fastify server initialization, routes, validator compiler, and error handler.
- `src/on-start-app.ts`: Startup bootstrap (dotenv, diagnostics, multi-instance, schema registry env handling).

**Configuration:**
- `package.json`: scripts (`dev`, `build`, `start`, `test`) and dependency graph.
- `tsconfig.json`: TypeScript compilation boundaries (`rootDir: src`, `outDir: dist`).
- `jest.config.js`: Jest runner config.
- `nodemon.json`: dev TS execution via `ts-node/register`.
- `Dockerfile`: container build.

**Core Logic:**
- HTTP API: `src/router.ts`
- Subscribe: `src/kafka/subscribe.ts`
- Consume: `src/kafka/consume.ts`
- Produce: `src/kafka/produce.ts`
- Subscribers store: `src/kafka/subscribers/*`
- Schema registry: `src/kafka/schema-registry/index.ts`

**Testing:**
- Kafka logic tests: `test/kafka/*.test.ts`

## Naming Conventions

**Files:**
- Use kebab-case for file names: `src/on-start-app.ts`, `src/kafka/connection-timeout.ts`, `src/kafka/subscribers/redis-subscribers-manager.ts`.
- Use `index.ts` as a barrel where a folder exposes its public API: `src/kafka/subscribers/index.ts`, `src/log/index.ts`, `src/multi-instance/index.ts`, `src/errors/index.ts`, `src/server-validation/index.ts`.

**Directories:**
- Use kebab-case for feature/grouping directories: `src/multi-instance/`, `src/server-validation/`, `src/server-errors/`.

## Where to Add New Code

**New HTTP Endpoint:**
- Route handler + wiring: `src/router.ts`
- Request schema: add to `src/server-validation/index.ts` and attach via `schema: ...` in the route.
- Shared request/response types: `src/types/index.ts`.

**New Kafka Operation (use-case):**
- Create a new module in `src/kafka/` (kebab-case file name).
- Keep Fastify-specific logic out of the module; accept plain params/options types from `src/types/index.ts`.
- Wire it into `src/router.ts`.

**New Subscriber State Behavior:**
- Single-instance behavior: extend `src/kafka/subscribers/subscribers-manager.ts`.
- Multi-instance behavior: extend `src/kafka/subscribers/redis-subscribers-manager.ts` and/or `src/kafka/subscribers/redis-subscriber.ts`.
- Export new manager operations via `src/kafka/subscribers/index.ts`.

**New Redis utilities:**
- Client/config changes: `src/redis/redis-client.ts`, `src/redis/constants.ts`.
- Key conventions related to subscribers: `src/kafka/subscribers/redis-keys.ts`.

**Utilities:**
- Kafka-adjacent helpers: `src/kafka/*.ts` (existing pattern is to keep helpers close to use-cases).
- Cross-cutting helpers: place near the owning subsystem folder rather than creating a global utils folder.

## Special Directories

**`dist/`**
- Purpose: compiled output used by `yarn start` (`package.json` points to `dist`).
- Generated: Yes
- Committed: Yes

**`patches/`**
- Purpose: `patch-package` patch files applied on install.
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-02-18*
