---
phase: 01-oom-fast-fixes
plan: 02
subsystem: infra
tags: [redis, kafka, memory, ltrim, lrange]

requires:
  - phase: 01-oom-fast-fixes
    provides: Bounded in-memory subscriber retention and bounded HTTP consume/debug responses
provides:
  - Bounded Redis list retention per subscriber via RPUSH + LTRIM + EXPIRE
  - Bounded Redis message retrieval via LRANGE tail reads
affects: [multi-instance, redis, consume, debug, oom]

tech-stack:
  added: []
  patterns:
    - "Bounded retention: cap on write + cap on read"

key-files:
  created: []
  modified:
    - src/kafka/subscribers/redis-subscriber.ts
    - src/kafka/subscribers/messages.ts
    - src/kafka/subscribers/constants.ts

key-decisions:
  - "Reuse MAX_SUBSCRIBER_MESSAGES as the cap for Redis list trimming/reads to match single-instance behavior"

patterns-established:
  - "Redis list safety: never read full list; always use tail window"

duration: 1 min
completed: 2026-02-18
---

# Phase 1 Plan 02: OOM Fast Fixes (Redis Retention) Summary

**Redis-backed subscriber message retention is now bounded on write (LTRIM) and on read (tail LRANGE) to prevent Redis growth and Node heap spikes.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-18T09:24:54Z
- **Completed:** 2026-02-18T09:26:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added per-message Redis list trimming so per-subscriber lists cannot grow beyond the configured cap within TTL.
- Replaced unbounded Redis list reads with bounded tail reads to avoid pulling/serializing huge arrays in runtime paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Trim Redis lists on write (RPUSH + LTRIM + EXPIRE)** - `56ae1ba` (feat)
2. **Task 2: Replace unbounded Redis list reads with tail reads** - `d1e37e5` (perf)

## Files Created/Modified
- `src/kafka/subscribers/redis-subscriber.ts` - Append now trims list (LTRIM) after RPUSH and preserves TTL refresh.
- `src/kafka/subscribers/messages.ts` - Redis message retrieval uses bounded tail `LRANGE -N -1`.
- `src/kafka/subscribers/constants.ts` - Exposes Redis retention cap aligned to `MAX_SUBSCRIBER_MESSAGES`.

## Decisions Made
- Reused `MAX_SUBSCRIBER_MESSAGES` as the Redis list cap (via `MAX_REDIS_SUBSCRIBER_MESSAGES`) to keep single-instance and Redis modes behaviorally consistent.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `01-oom-fast-fixes-03` follow-ups if any remain in this phase.

---
*Phase: 01-oom-fast-fixes*
*Completed: 2026-02-18*
