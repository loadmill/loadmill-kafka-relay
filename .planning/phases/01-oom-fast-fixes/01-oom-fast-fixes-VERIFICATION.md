---
phase: 01-oom-fast-fixes
verified: 2026-02-18T09:30:18Z
status: passed
score: 5/5 must-haves verified
---

# Phase 01: OOM Fast Fixes Verification Report

**Phase Goal:** Prevent the Kafka relay from crashing due to unbounded memory growth by bounding retained messages per subscriber (count + bytes), bounding Redis-backed message lists and avoiding unbounded LRANGE reads, and making `/consume` and `/debug` responses bounded by default.

**Verified:** 2026-02-18T09:30:18Z
**Status:** passed
**Re-verification:** No — initial verification

## Commands Used

- `wc -l src/kafka/subscribers/{message-limits.ts,subscriber.ts,redis-subscriber.ts,messages.ts,constants.ts} src/kafka/{consume.ts,debug/index.ts} src/{router.ts,server-validation/index.ts} test/kafka/{message-limits.test.ts,consume.test.ts}`
- `rg -n "TODO|FIXME|XXX|HACK|placeholder|coming soon|not implemented|return null|return \{\}|return \[\]" src/kafka/subscribers/{message-limits.ts,subscriber.ts,redis-subscriber.ts,messages.ts,constants.ts} src/kafka/{consume.ts,debug/index.ts} src/{router.ts,server-validation/index.ts}`
- `rg -n "LRANGE\\s+0\\s+-1|lRange\\([^\\n]*0[^\\n]*-1" src`
- `rg -n "getMessagesFromRedis\\(" src`
- `rg -n "DEFAULT_CONSUME_LIMIT|MAX_CONSUME_LIMIT|resolvedLimit" src/router.ts`
- `rg -n "DEBUG_MESSAGE_SAMPLE_SIZE|getLastN\\(" src/kafka/debug/index.ts`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---:|-------|--------|----------|
| 1 | Single-instance mode per-subscriber retention is bounded by count + bytes, using drop-oldest eviction | ✓ VERIFIED | `src/kafka/subscribers/subscriber.ts` calls `enforceMessageLimits(this.messages, { maxMessages: MAX_SUBSCRIBER_MESSAGES, maxBytes: MAX_SUBSCRIBER_BYTES })` after every `push()`, which evicts via `shift()` loop in `src/kafka/subscribers/message-limits.ts` |
| 2 | Redis mode per-subscriber message lists are bounded on write and have TTL | ✓ VERIFIED | `src/kafka/subscribers/redis-subscriber.ts` uses `multi().rPush(...).lTrim(key, -MAX_REDIS_SUBSCRIBER_MESSAGES, -1).expire(key, MAX_SUBSCRIBER_TTL_SECONDS).exec()` |
| 3 | Redis mode reads are bounded; no runtime path uses `LRANGE 0 -1` | ✓ VERIFIED | `src/kafka/subscribers/messages.ts` uses `lRange(key, -MAX_REDIS_SUBSCRIBER_MESSAGES, -1)`; repo-wide ripgrep found no `LRANGE 0 -1`/`lRange(..., 0, -1)` matches |
| 4 | `GET /consume/:id` is bounded by default and enforces a max bound; consume logic short-circuits to avoid building huge arrays | ✓ VERIFIED | Router clamps `resolvedLimit` to `[1..1000]` with default `100` in `src/router.ts`; `src/kafka/consume.ts` uses `takeCount = min(max(multiple??1, 1), limit)` and tail-scans from newest to oldest breaking once `takeCount` matches found (no full-filter array build in request path) |
| 5 | `/debug` response is bounded: returns counts + bounded samples per subscriber | ✓ VERIFIED | `src/kafka/debug/index.ts` uses `DEBUG_MESSAGE_SAMPLE_SIZE = 10`, returns `messagesCount: messages.length` plus `messages: truncateMessages(getLastN(messages, 10))` |

**Score:** 5/5 truths verified

## Required Artifacts (Existence + Substantive + Wired)

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `src/kafka/subscribers/message-limits.ts` | Centralized caps logic (count+bytes) + eviction | ✓ VERIFIED | 101 LOC; exports `estimateConsumedMessageBytes()` + `enforceMessageLimits()` with drop-oldest loop |
| `src/kafka/subscribers/subscriber.ts` | Applies caps during single-instance message retention | ✓ VERIFIED | 125 LOC; `addMessage()` pushes then enforces caps; `getMessages()` returns retained list (bounded by invariant) |
| `src/kafka/subscribers/constants.ts` | Env-backed caps w/ clamps + Redis cap alias | ✓ VERIFIED | Defines `MAX_SUBSCRIBER_MESSAGES` (default 1000, max 100k) and `MAX_SUBSCRIBER_BYTES` (default 10MiB, max 512MiB); `MAX_REDIS_SUBSCRIBER_MESSAGES = MAX_SUBSCRIBER_MESSAGES` |
| `src/kafka/subscribers/redis-subscriber.ts` | Redis retention bounded on write with TTL | ✓ VERIFIED | Uses `RPUSH` + `LTRIM ... -N -1` + `EXPIRE` in a multi/transaction |
| `src/kafka/subscribers/messages.ts` | Bounded tail reads from Redis | ✓ VERIFIED | `getMessagesFromRedis()` calls `lRange(key, -N, -1)` then parses; no unbounded read |
| `src/router.ts` | `/consume` parses/enforces default+max limit | ✓ VERIFIED | `DEFAULT_CONSUME_LIMIT=100`, `MAX_CONSUME_LIMIT=1000`, passes `limit: resolvedLimit` into `consume()` |
| `src/kafka/consume.ts` | Consume returns ≤ limit and avoids huge intermediate arrays | ✓ VERIFIED | `findLatestMessages()` pushes only up to `takeCount` and breaks early; `handleTextOption()` parses only returned messages |
| `src/kafka/debug/index.ts` | Debug output bounded with counts + samples | ✓ VERIFIED | Samples last 10 only; returns counts separately |
| `test/kafka/message-limits.test.ts` | Regression tests for eviction behavior | ✓ VERIFIED | Covers maxMessages eviction, maxBytes eviction, combined constraints + order |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/kafka/subscribers/subscriber.ts` | `src/kafka/subscribers/message-limits.ts` | `enforceMessageLimits(...)` | WIRED | Called in `addMessage()` after push |
| `src/kafka/subscribers/redis-subscriber.ts` | Redis | `RPUSH + LTRIM + EXPIRE` | WIRED | Multi chain includes `.rPush`, `.lTrim(...-N,-1)`, `.expire` |
| `src/kafka/subscribers/messages.ts` | Redis | tail `LRANGE -N -1` | WIRED | `lRange(key, -MAX_REDIS_SUBSCRIBER_MESSAGES, -1)` |
| `src/router.ts` | `src/kafka/consume.ts` | query `limit` → `consumeOptions.limit` | WIRED | `resolvedLimit` computed and passed to `consume()` |
| `/debug` route (`src/router.ts`) | `src/kafka/debug/index.ts` | `getDebugData()` | WIRED | `/debug` handler returns `await getDebugData()` |

## Requirements Coverage

Requirements coverage evaluated against `.planning/REQUIREMENTS.md` (created during this execution).

## Anti-Patterns Found

No TODO/FIXME/placeholder/empty-return stub patterns found in the key files listed above (ripgrep scan produced no matches).

## Human Verification Required

None required to confirm the *bounds* exist structurally. (Optional: load-test for performance/latency is still a human/ops concern, not a correctness gap.)

---

_Verified: 2026-02-18_
_Verifier: OpenCode (gsd-verifier)_
