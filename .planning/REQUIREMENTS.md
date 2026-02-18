# Requirements

Last updated: 2026-02-18

## Traceability

| ID | Requirement | Phase | Status | Notes |
|----|-------------|-------|--------|-------|
| OOM-01 | Bound in-memory per-subscriber retention (max messages + max bytes; drop-oldest) | 01 | Complete | Implemented in plan 01 (see 01-01-SUMMARY) |
| OOM-02 | Bound Redis-backed retention (trim lists; avoid unbounded reads) | 01 | Complete | Implemented in plan 02 (see 01-02-SUMMARY) |
| OOM-03 | Bound API responses (`/consume` and `/debug`) with sensible defaults and max limits | 01 | Complete | Implemented in plan 03 (see 01-03-SUMMARY) |
