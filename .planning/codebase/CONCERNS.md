# Codebase Concerns

**Analysis Date:** 2026-02-18

## Tech Debt

**In-memory subscribers store unbounded messages (single-instance mode):**
- Issue: `Subscriber` appends consumed messages to an in-memory array with no cap/eviction.
- Files: `src/kafka/subscribers/subscriber.ts`, `src/kafka/subscribers/subscribers-manager.ts`
- Impact: Memory growth is proportional to topic traffic; can OOM the process; `/debug` and `/consume` response sizes can grow without bound.
- Fix approach: Introduce a per-subscriber max message count/bytes and drop oldest on insert; consider storing only offsets and fetching on consume; enforce caps consistently in both `Subscriber.addMessage()` and `/debug`.

**Redis-backed message storage is also unbounded per TTL window:**
- Issue: Messages are appended to Redis list with TTL refresh on every message; no list trimming.
- Files: `src/kafka/subscribers/redis-subscriber.ts`, `src/kafka/subscribers/constants.ts` (`MAX_SUBSCRIBER_TTL_SECONDS`)
- Impact: High-volume topics can create very large Redis lists within the TTL window; increased Redis memory usage; slower `/consume` and `/debug` due to `LRANGE 0 -1`.
- Fix approach: Trim lists with `LTRIM` after `RPUSH` (e.g., last N messages); store only metadata + last offset; cap `/consume` reads.

**Multi-instance subscriber discovery uses Redis `KEYS` (blocking):**
- Issue: Uses `redisClient.keys()` to discover subscribers by pattern.
- Files: `src/kafka/subscribers/redis-subscribers-manager.ts` (`getAllSubscribersKeysFromRedis`)
- Impact: `KEYS` is O(N) and blocks Redis; can degrade the entire Redis instance under load; scales poorly with key count.
- Fix approach: Replace with `SCAN` or maintain an index/set per instance (e.g., `SADD`/`SREM` subscriber ids) so discovery is O(1) or incremental.

**Multi-instance expiry deletion interval is duplicated and not stoppable:**
- Issue: `RedisSubscribersManager` calls `super()` (which starts an interval and stores `intervalId`), then calls `this.startDeletingExpiredSubscribers()` again; override uses `setInterval` but does not set `intervalId` (so `stopDeletingExpiredSubscribers()` cannot stop it).
- Files: `src/kafka/subscribers/subscribers-manager.ts`, `src/kafka/subscribers/redis-subscribers-manager.ts`
- Impact: Multiple expiry loops run; extra Redis load; tests calling `subscriptionsManager.stopDeletingExpiredSubscribers()` stop only one interval.
- Fix approach: In `RedisSubscribersManager`, do not start a second interval; reuse base `intervalId` tracking or override with proper `intervalId` assignment + `clearInterval` support.

**Environment-variable injection is overly permissive and lossy:**
- Issue: Any string value containing `<...>` is replaced by `process.env[VAR] || ''` recursively across the request body; missing vars silently become empty strings; brokers strings are split by commas.
- Files: `src/inject-env/index.ts`
- Impact: Silent misconfiguration (empty values) is hard to debug; allows clients to reference arbitrary env var names (including secrets) to affect runtime behavior; can produce invalid broker lists and hard-to-trace auth failures.
- Fix approach: Enforce an allowlist of injectable env var names; fail validation if a referenced env var is missing; only allow injection for specific fields (e.g., `brokers`, `sasl.username`, `sasl.password`).

**Schema registry “global encode schema” is not applied to produced messages:**
- Issue: `setEncodeSchema()` computes a registry id but does not store it in `activeSchemaId` (and `produceMessage()` only encodes when request-level `encode` is provided).
- Files: `src/kafka/schema-registry/index.ts` (`setEncodeSchema`, `activeSchemaId`), `src/kafka/produce.ts` (`prepareValue`)
- Impact: `/registry/encode` has no effect on subsequent `/produce` calls unless the client also supplies `encode` in the request; behavior contradicts README/API expectations.
- Fix approach: Call `setActiveSchemaId(activeSchemaId)` inside `setEncodeSchema()`; in `src/kafka/produce.ts`, fall back to global encoding when request `encode` is absent.

**File logging inside container by default:**
- Issue: Logger always writes to `${APP_NAME}.log` via `fs.createWriteStream`.
- Files: `src/log/pino-logger.ts`, `Dockerfile`
- Impact: In containerized deployments, file logs are not reliably retained/rotated; can fill ephemeral storage; duplicates stdout logs.
- Fix approach: Make file logging opt-in via env var; default to stdout-only in containers; add rotation if file logging is required.

**Patch-package override of `avsc` “safe long” behavior:**
- Issue: Patch changes `isSafeLong` check to `return typeof n == 'number';`.
- Files: `patches/avsc+5.7.7.patch`
- Impact: Changes upstream validation semantics for long bounds; may accept values previously rejected; can create subtle serialization/deserialization correctness issues.
- Fix approach: Document the rationale + expected behavior in-repo; add regression tests for Avro long behavior; prefer upstream fix or a wrapper rather than patching vendored code.

## Known Bugs

**Multi-instance shutdown cleanup can be skipped due to competing SIGTERM/SIGINT handlers:**
- Symptoms: On SIGTERM/SIGINT, process exits without unregistering instance / announcing shutdown / disconnecting Redis.
- Files: `src/diagnostics/exit-log.ts`, `src/multi-instance/shutdown-signal-handlers.ts`, `src/multi-instance/instance-manager.ts`, `src/on-start-app.ts`
- Trigger: Multi-instance mode (`REDIS_URL` set) and the process receives SIGTERM/SIGINT.
- Workaround: Not detected.

**Why this happens (current wiring):**
- `src/on-start-app.ts` always calls `initExitHandlers()` (which registers `process.once('SIGTERM'|'SIGINT')` and immediately `process.exit(0)`), then in multi-instance mode registers additional `process.on('SIGTERM'|'SIGINT')` handlers that run `onShutdown()`.
- Listener order means the exit handler can terminate the process before `onShutdown()` completes.

## Security Considerations

**No authentication/authorization on HTTP endpoints (open network binding):**
- Risk: Anyone who can reach the server can call `/produce` to send arbitrary messages to Kafka, `/subscribe` to create consumers, `/consume` to read messages, and `/debug` to inspect relay state.
- Files: `src/router.ts` (binds `host: '0.0.0.0'` and defines all routes)
- Current mitigation: Not detected.
- Recommendations: Add an auth layer (API key / mTLS / JWT) and restrict bind interface by default; at minimum require auth for `/debug`, `/produce`, and `/subscribe`.

**Potential sensitive data exposure via `/debug` and logging:**
- Risk: `/debug` returns subscription ids, topics, timestamps, and message metadata; message values are truncated but the number of messages is not capped, and metadata may still be sensitive.
- Files: `src/kafka/debug/index.ts`, `src/kafka/subscribers/messages.ts`, `src/log/pino-logger.ts`
- Current mitigation: Value truncation to ~10 chars in `truncateMessages()`.
- Recommendations: Require auth; cap number of messages returned; return only aggregated stats by default; avoid file logging or redact sensitive fields.

**Regex-based filtering built directly from user input (ReDoS risk):**
- Risk: `new RegExp(userInput)` allows catastrophic backtracking patterns that consume CPU.
- Files: `src/kafka/consume.ts` (`filterMessages`)
- Current mitigation: Request validation uses AJV `format: 'regex'` but runtime still compiles regex from user input.
- Recommendations: Add a safe-regex check or limit regex length/complexity; consider using RE2-compatible engine; catch regex compilation errors and return 400.

**Error handler may leak internals (stack/fields) in responses:**
- Risk: Error handler returns `{ error: { ...error, message } }` which can include stack traces, internal fields, and library-specific metadata.
- Files: `src/server-errors/index.ts`
- Current mitigation: Status codes are set based on error type.
- Recommendations: Return a sanitized error shape only (no `stack`, no raw error spread); gate detailed errors behind `NODE_ENV === 'development'`.

**Redis fatal error handler logs `REDIS_URL` and exits process:**
- Risk: `REDIS_URL` may contain credentials (e.g., `rediss://user:pass@host`); logs include it; process exit is a denial-of-service vector if Redis becomes briefly unavailable.
- Files: `src/redis/redis-client.ts`
- Current mitigation: None.
- Recommendations: Redact credentials from logged URLs; replace `process.exit(1)` with retry/backoff and circuit-breaker behavior.

## Performance Bottlenecks

**Polling-based consume loop (no push/notify):**
- Problem: `/consume/:id` polls stored messages every 2s until timeout.
- Files: `src/kafka/consume.ts` (`getMessagesOrTimeout`, `WAIT_INTERVAL_MS`)
- Cause: Simple polling loop + repeated filtering.
- Improvement path: Implement long-poll with notification (e.g., per-subscriber promise/condition, pubsub, or stream), reduce polling interval dynamically, or return immediately with cursor/offset.

**`/debug` does N+1 message fetch and returns potentially huge payload:**
- Problem: Fetches messages for every subscriber and returns them (value truncated but array length uncapped).
- Files: `src/kafka/debug/index.ts`, `src/kafka/subscribers/messages.ts` (`getMessagesFromRedis` uses `LRANGE 0 -1`)
- Cause: `Promise.all(subscriberIds.map(id => subscribers[id].getMessages()))` combined with full list reads.
- Improvement path: Return only counts + last message summary; cap per-subscriber message sample size; avoid `LRANGE 0 -1`.

**Redis `KEYS` usage under load:**
- Problem: Uses `redisClient.keys(pattern)`.
- Files: `src/kafka/subscribers/redis-subscribers-manager.ts`
- Cause: Pattern-based discovery.
- Improvement path: Replace with `SCAN` or maintained indexes.

## Fragile Areas

**Multi-instance handover logic (takeover + resubscribe) is sensitive to timing and offsets:**
- Files: `src/multi-instance/instance-manager.ts`, `src/kafka/subscribers/redis-subscribers-manager.ts` (`takeOverSubscribers`, `inferTimestamp`), `src/kafka/subscribers/subscriber.ts` (`fetchTopicOffsetsByTimestamp`, `seek`)
- Why fragile: Uses inferred timestamp from last stored message and adds `+1` to avoid duplicates; relies on message timestamps being monotonic and comparable across partitions; resubscribing/assigning partitions occurs after `consumer.run()`.
- Safe modification: Preserve ordering of subscribe/seek operations; add explicit tests for takeover behavior; avoid timestamp inference and instead persist per-partition offsets.
- Test coverage: No tests detected for takeover logic or RedisSubscribersManager.

**Shutdown/exit behavior spans multiple modules and can conflict:**
- Files: `src/diagnostics/exit-log.ts`, `src/diagnostics/crash-log.ts`, `src/multi-instance/shutdown-signal-handlers.ts`, `src/on-start-app.ts`
- Why fragile: Multiple signal handlers exist with different semantics (`once` vs `on`, immediate `process.exit` vs async cleanup).
- Safe modification: Centralize signal handling in a single module; ensure async cleanup completes before exit; avoid calling `process.exit` in multiple places.
- Test coverage: Not detected.

## Scaling Limits

**Subscriber group id equals subscription id (one consumer group per subscription):**
- Current capacity: One Kafka consumer per active subscription.
- Limit: High subscription counts can exhaust broker connection quotas and increase CPU/memory; consumers are only cleaned up by TTL/expiry timers.
- Files: `src/kafka/subscribers/subscriber.ts` (`groupId: this.id`), `src/kafka/subscribers/constants.ts`
- Scaling path: Pool/limit concurrent consumers; share consumer groups when appropriate; enforce max active subscribers per instance; implement explicit unsubscribe on inactivity.

## Dependencies at Risk

**Reliance on patched `avsc` behavior:**
- Risk: Patch can break on dependency upgrades and differs from upstream.
- Impact: Avro decoding/encoding correctness and upgrade complexity.
- Files: `patches/avsc+5.7.7.patch`, `package.json` (uses `patch-package`)
- Migration plan: Remove patch by upgrading to a version that supports required behavior or by isolating long-handling in a dedicated conversion layer.

## Missing Critical Features

**HTTP API access control / rate limiting:**
- Problem: Service exposes Kafka produce/consume operations without auth or rate limits.
- Blocks: Safe deployment outside trusted networks.
- Files: `src/router.ts`

**Resource limits (message caps, subscriber caps, request caps):**
- Problem: No hard caps on messages per subscriber or debug payload size.
- Blocks: Predictable memory/Redis usage in production.
- Files: `src/kafka/subscribers/subscriber.ts`, `src/kafka/subscribers/redis-subscriber.ts`, `src/kafka/debug/index.ts`

## Test Coverage Gaps

**Untested multi-instance behavior (RedisSubscribersManager, takeover, shutdown):**
- What's not tested: Redis key/index management, takeover correctness, delete propagation, and graceful shutdown.
- Files: `src/kafka/subscribers/redis-subscribers-manager.ts`, `src/multi-instance/instance-manager.ts`, `src/multi-instance/shutdown-signal-handlers.ts`, `src/diagnostics/exit-log.ts`
- Risk: Production-only failures (race conditions, leaked consumers, stuck keys, data loss/duplication).
- Priority: High

**Untested HTTP routes and error-handling contract:**
- What's not tested: Fastify route schemas, env injection, error payload sanitization, and validation integration.
- Files: `src/router.ts`, `src/inject-env/index.ts`, `src/server-errors/index.ts`, `src/server-validation/index.ts`
- Risk: Breaking API behavior and unintended information disclosure.
- Priority: Medium

---

*Concerns audit: 2026-02-18*
