# Roadmap

Last updated: 2026-02-18

## Phases

| Phase | Name | Goal | Status |
|------:|------|------|--------|
| 01 | OOM Fast Fixes | Bound message retention + API responses to prevent Node OOM in both single-instance and Redis modes | In Progress |

## Phase 01: OOM Fast Fixes

Goal: Prevent the Kafka relay from crashing due to unbounded memory growth by:
- Bounding retained messages per subscriber (count + bytes)
- Bounding Redis-backed message lists and avoiding unbounded LRANGE reads
- Making `/consume` and `/debug` responses bounded by default

Plans:
- 01-01: Bound in-memory subscriber retention (Complete)
- 01-02: Bound Redis retention + reads (Planned)
- 01-03: Bound API responses (/consume + /debug) (Complete)
