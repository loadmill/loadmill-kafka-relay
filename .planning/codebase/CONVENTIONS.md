# Coding Conventions

**Analysis Date:** 2026-02-18

## Naming Patterns

**Files:**
- Use **kebab-case** for file names.
  - Examples: `src/on-start-app.ts`, `src/server-errors/index.ts`, `src/kafka/schema-registry/index.ts`, `src/kafka/subscribers/redis-subscribers-manager.ts`

**Functions:**
- Use **camelCase** for functions.
  - Examples: `src/kafka/consume.ts` (`filterMessages`, `getMessagesOrTimeout`), `src/server-errors/index.ts` (`serverErrorHandler`)
- Use **verb-first** names for actions.
  - Examples: `src/kafka/produce.ts` (`produceMessage`, `prepareProduceMessage`), `src/kafka/subscribe.ts` (`subscribe`)

**Variables:**
- Use **camelCase** for variables and parameters.
  - Examples: `src/kafka/consume.ts` (`regexFilter`, `headerValueRegexFilter`, `timeoutMs`)
- Use **UPPER_SNAKE_CASE** for constants.
  - Examples: `src/kafka/consume.ts` (`MAX_QUERY_TIME_MS`, `WAIT_INTERVAL_MS`), `src/constants.ts` (`APP_NAME`, `TRUE_AS_STRING_VALUES`)

**Types:**
- Prefer **`type` aliases** for object shapes and unions.
  - Examples: `src/types/index.ts` (e.g. `ConsumeOptions`, `RegistryOptions`), `src/server-errors/index.ts` (`ResponseError`, `PresentableError`)
- Use `enum` for constrained string sets where referenced across modules.
  - Example: `src/types/index.ts` (`ConvertType`)

## Code Style

**Formatting:**
- Formatting is ESLint-driven (no Prettier config detected).
- Enforced settings are defined in `/.eslintrc.js`.

Key settings from `/.eslintrc.js`:
- Indentation: **2 spaces** (`indent: ["error", 2, { SwitchCase: 1 }]`).
- Quotes: **single quotes** (`quotes: ['error', 'single']`).
- Semicolons: **required** (`semi: ['error', 'always']`, `@typescript-eslint/semi`).
- Max line length: **200** (`max-len: ['error', 200]`).
- Trailing commas: **always-multiline** (`comma-dangle: ['error', 'always-multiline']`).
- Curly braces required (`curly: ['error']`).
- No trailing spaces (`no-trailing-spaces: 'error'`).
- Limit consecutive blank lines (`no-multiple-empty-lines`).

**Linting:**
- ESLint + TypeScript ESLint is the primary quality gate.
  - Config: `/.eslintrc.js`
  - TS project for typed lint rules: `/tsconfig.eslint.json`
- Module boundary types must be explicit for TypeScript files.
  - Rule: `@typescript-eslint/explicit-module-boundary-types: 'error'` (override for `*.ts` in `/.eslintrc.js`)
- `any` is disallowed by default.
  - Rule: `@typescript-eslint/no-explicit-any: 'error'`
  - Exception: allowed in `src/inject-env/index.ts` (override in `/.eslintrc.js`)
- Unused imports are errors.
  - Rule: `unused-imports/no-unused-imports: 'error'`
- Key sorting is enforced broadly.
  - Rule: `sort-keys: 'error'` and `plugin:typescript-sort-keys/recommended` in `/.eslintrc.js`

## Import Organization

**Order:**
1. Builtins
2. External
3. Internal
4. Parent
5. Sibling
6. Index

This is enforced by `import/order` in `/.eslintrc.js` with:
- Alphabetized imports (case-insensitive)
- Blank lines between import groups (`newlines-between: 'always'`)

Example grouping and spacing: `src/router.ts`.

**Path Aliases:**
- Not detected. Imports are relative (e.g. `../../types`) and direct package imports.
  - Evidence: `tsconfig.json` has no `compilerOptions.baseUrl`/`paths` configured.

## Error Handling

**Patterns:**
- Use a dedicated client error type for user-facing HTTP errors.
  - `src/errors/index.ts`: `ClientError` carries `statusCode` (and optional payload).
  - Throw `ClientError` from application logic when input/state is invalid.
    - Examples: `src/router.ts` (404 when subscriber missing), `src/kafka/convert.ts` (400 on unknown conversion), `src/kafka/schema-registry/index.ts` (400 when registry not initialized)

- Centralize HTTP error mapping in Fastify error handler.
  - `src/server-errors/index.ts`: `serverErrorHandler(error, request, reply)`
    - Logs `request.log.error(error)`
    - Maps known error types to status codes and messages
    - Returns `{ error: { ...error, message } }` payload

- For non-fatal decode failures, log at debug and continue.
  - `src/kafka/schema-registry/index.ts`: `decode()` catches specific decode errors, logs debug, otherwise rethrows.

## Logging

**Framework:** pino
- Base logger: `src/log/pino-logger.ts` exports `pinoLogger`
  - Dev: pretty transport (`pino-pretty`)
  - Always adds a file stream `${APP_NAME}.log` (`src/log/pino-logger.ts`)
- App-wide logger wrapper to adapt KafkaJS-style calls:
  - `src/log/kafka-pino-adapter.ts`: `KafkaRelayLogger`
  - Default export: `src/log/index.ts`

**Patterns:**
- Prefer structured logs with context objects:
  - Examples: `src/redis/redis-client.ts` (`log.info({ url }, ...)`, `log.error({ REDIS_URL, clientType, error }, ...)`)
  - Examples: `src/kafka/subscribers/redis-subscribers-manager.ts` (`log.debug({ id, topic }, ...)`)
- In Fastify request handlers, use `request.log` (pino bound to request):
  - `src/server-errors/index.ts`

## Comments

**When to Comment:**
- Use comments/JSDoc for non-obvious behavior and side effects.
  - Example: `src/kafka/encode-headers.ts` documents that it mutates `headers` and encodes recursively.
  - Example: `src/kafka/subscribers/redis-subscribers-manager.ts` documents multi-instance intent.

**JSDoc/TSDoc:**
- Used sparingly, primarily to document mutation/side effects.
  - Example: `src/kafka/encode-headers.ts`

## Function Design

**Size:**
- Prefer small helpers within module scope; split complex flows into private/internal functions.
  - Example: `src/kafka/consume.ts` separates `consume()`, `getMessagesOrTimeout()`, `filterMessages()`, `handleTextOption()`.

**Parameters:**
- Destructure inputs and pass typed option objects.
  - Example: `src/kafka/consume.ts` (`{ id }: ConsumeParams`, `{ headerValueRegexFilter, ... }: ConsumeOptions`)
  - Example: `src/kafka/produce.ts` accepts `{ brokers, message, topic }` + `options`.

**Return Values:**
- Use explicit Promise return types for exported async functions.
  - Example: `src/kafka/consume.ts` returns `Promise<ConsumedMessage[]>`.
  - Rule-enforced: `@typescript-eslint/explicit-module-boundary-types` in `/.eslintrc.js`.

## Module Design

**Exports:**
- Prefer **named exports** for functions and types.
  - Examples: `src/kafka/consume.ts`, `src/server-errors/index.ts`, `src/types/index.ts`
- Use **default export** sparingly for singletons.
  - Example: `src/log/index.ts` default-exports a `KafkaRelayLogger` instance.

**Barrel Files:**
- Use `index.ts` as a barrel to re-export module APIs.
  - Examples: `src/kafka/subscribers/index.ts`, `src/server-errors/index.ts`, `src/types/index.ts`, `src/multi-instance/index.ts`

---

*Convention analysis: 2026-02-18*
