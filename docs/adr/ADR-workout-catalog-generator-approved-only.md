# ADR: Generator APPROVED-only + session snapshot preservation

**Status:** Accepted for WORKOUT-CATALOG-01A  
**Date:** 2026-08-02

## Decision

1. Generator loads exercises only from the current PUBLISHED release items with APPROVED revisions and `enabledForGenerator=true`.
2. Session snapshots from WORKOUT-V2-01C remain the execution SoT; catalog revision/release changes must not rewrite historical session rows.

## Consequences

- Algorithm stamp becomes `workout-catalog-01a.1`.
- Historical plans without release provenance remain readable.
- Media `storageKey` stays out of public API.
