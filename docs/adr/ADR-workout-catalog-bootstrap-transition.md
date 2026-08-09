# ADR: Bootstrap transition from legacy workout seed

**Status:** Accepted for WORKOUT-CATALOG-01A  
**Date:** 2026-08-02

## Decision

Bootstrap release `workout-catalog-bootstrap-01a` copies the 20 existing seed exercises into APPROVED revision 1 and publishes them for the generator. The 84-entry target manifest remains the inventory SoT; planned rows are not generator-eligible until 01B.

## Consequences

- Existing Exercise IDs/keys unchanged.
- Generator continues to have a sufficient catalog after migration 210.
- Manifest count (84) ≠ runtime APPROVED subset (20).
