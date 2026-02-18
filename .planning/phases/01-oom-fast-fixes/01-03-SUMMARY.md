---
phase: 01-oom-fast-fixes
plan: 03
subsystem: api
tags: [fastify, ajv, kafka, redis, oom, memory]

# Dependency graph
requires:
  - phase: 01-oom-fast-fixes
    provides: Subscriber retention caps (count + bytes) to bound backlog growth
provides:
  - Bounded `/consume/:id` responses via default + max `limit`
  - Consume early-exit filtering that avoids parsing/processing extra messages
  - Bounded `/debug` output via per-subscriber counts + sampled messages
affects: [consume, debug, validation, performance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transport-layer query parameter enforcement (default + clamp)"
    - "Tail-scan filtering with early exit to avoid building large arrays"

key-files:
  created: []
  modified:
    - src/server-validation/index.ts
    - src/router.ts
    - src/types/index.ts
    - src/kafka/consume.ts
    - src/kafka/debug/index.ts

key-decisions:
  - "Clamp (not 400) consume `limit` to a safe max for consistent bounded behavior"

patterns-established:
  - "All endpoints that return message arrays must have a default cap and enforced maximum"

# Metrics
duration: 8 min
completed: 2026-02-18
---

# Phase 01 Plan 03: OOM fast fixes summary

**/consume and /debug now enforce bounded, sampled responses to prevent request-time JSON serialization OOMs.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-18T09:13:57Z
- **Completed:** 2026-02-18T09:22:40Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `limit` query validation and router-side default/max enforcement for `GET /consume/:id`.
- Updated consume flow to stop scanning once enough matches are found and to only JSON-parse messages that will be returned.
- Made `/debug` safe by returning per-subscriber message counts plus a bounded sample of truncated messages.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `limit` to consume validation + enforce default/max in router** - `6e7660f` (feat)
2. **Task 2: Enforce consume result bounds in consume use-case** - `c6778b0` (perf)
3. **Task 3: Cap debug output (sample + counts)** - `2ec3730` (feat)

## Files Created/Modified

- `src/server-validation/index.ts` - validates optional `limit` query (1..1000) for `/consume/:id`.
- `src/router.ts` - applies default `limit=100` and clamps to `<=1000`, passing into consume options.
- `src/types/index.ts` - adds `ConsumeOptions.limit`.
- `src/kafka/consume.ts` - tail-scans for matches with early exit and enforces `<= limit` results.
- `src/kafka/debug/index.ts` - returns `messagesCount` plus last-10 sampled/truncated messages per subscriber.

## Decisions Made

- Clamped `limit` to a max (instead of returning 400) so responses remain bounded even with misconfigured/over-eager clients.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `01-oom-fast-fixes/01-02-PLAN.md` if Redis-mode trimming/tail-reads are still pending in this repo.

---
*Phase: 01-oom-fast-fixes*
*Completed: 2026-02-18*
