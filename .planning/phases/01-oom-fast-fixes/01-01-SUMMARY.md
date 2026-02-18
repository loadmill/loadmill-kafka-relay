---
phase: 01-oom-fast-fixes
plan: 01
subsystem: kafka
tags: [node, typescript, kafka, subscribers, memory, eviction, jest]

# Dependency graph
requires: []
provides:
  - Bounded in-memory per-subscriber message retention (count + approximate bytes)
  - Centralized drop-oldest eviction helper for retained messages
  - Unit tests for eviction behavior
affects: [consume, debug, redis-subscribers, oom-fast-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Drop-oldest eviction for bounded in-memory retention"
    - "Env-backed numeric caps with clamping defaults"

key-files:
  created:
    - src/kafka/subscribers/message-limits.ts
    - test/kafka/message-limits.test.ts
  modified:
    - src/kafka/subscribers/constants.ts
    - src/kafka/subscribers/subscriber.ts

key-decisions:
  - "Use cheap approximate byte estimation (no JSON stringify) and enforce caps at write-time in Subscriber.addMessage()"

patterns-established:
  - "Retained message arrays must be bounded via enforceMessageLimits(...)"

# Metrics
duration: 9 min
completed: 2026-02-18
---

# Phase 01 Plan 01: OOM Fast Fixes Summary

**Hard caps (count + bytes) for per-subscriber in-memory retention, enforced on insert with drop-oldest eviction and unit tests.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-18T09:01:42Z
- **Completed:** 2026-02-18T09:11:09Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added centralized message retention utilities to estimate size and evict oldest messages until within caps.
- Introduced env-backed numeric caps for per-subscriber retention (messages + bytes) with safe defaults/clamps.
- Enforced caps in single-instance `Subscriber.addMessage()` so memory cannot grow unbounded per subscriber.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add bounded message-limit utilities + env-backed defaults** - `55847b8` (feat)
   - _Follow-up lint-only fix_: `e219034` (style)
2. **Task 2: Enforce caps in in-memory Subscriber message retention** - `d30e56f` (feat)
3. **Task 3: Add focused unit tests for eviction + cap behavior** - `93bd688` (test)

## Files Created/Modified

- `src/kafka/subscribers/message-limits.ts` - Byte estimation + `enforceMessageLimits()` drop-oldest eviction helper.
- `src/kafka/subscribers/constants.ts` - Adds `MAX_SUBSCRIBER_MESSAGES` and `MAX_SUBSCRIBER_BYTES` env-backed caps with clamping.
- `src/kafka/subscribers/subscriber.ts` - Applies caps during `addMessage()` so retained list is always bounded.
- `test/kafka/message-limits.test.ts` - Unit tests for eviction behavior (maxMessages/maxBytes/combined).

## Decisions Made

- Use a cheap approximate byte estimator (string lengths + small constant overhead) to avoid allocations/JSON stringification while still bounding retained memory.
- Enforce caps immediately on write (`Subscriber.addMessage()`), using a strict drop-oldest policy to degrade gracefully under load.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-commit hook required lint/style conformance before committing Task 1/3**

- **Found during:** Task 1 and Task 3 (commits)
- **Issue:** ESLint rules (`curly`, `import/order`, `typescript-sort-keys`) blocked commits.
- **Fix:** Updated code to satisfy lint rules (no behavior changes).
- **Files modified:** src/kafka/subscribers/constants.ts, src/kafka/subscribers/message-limits.ts, test/kafka/message-limits.test.ts
- **Verification:** `yarn build` (lint + tsc + test) passes.
- **Committed in:** `e219034` (Task 1 style), Task 3 commit includes import order fix.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep; changes were required to pass repo hooks and ship the planned behavior.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Single-instance subscriber retention is now bounded; ready to address Redis-mode list trimming and bounded `/consume`/`/debug` reads in subsequent plans.

---

*Phase: 01-oom-fast-fixes*
*Completed: 2026-02-18*
