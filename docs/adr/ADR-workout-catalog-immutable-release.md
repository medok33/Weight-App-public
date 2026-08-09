# ADR: Immutable published workout catalog release

**Status:** Accepted for WORKOUT-CATALOG-01A  
**Date:** 2026-08-02

## Decision

Generator selection is gated by a single current `PUBLISHED` `WorkoutCatalogRelease`. Published releases and their items are immutable (DB triggers + service guards). Retiring a release preserves history.

A `PUBLISHED` release must **continuously** contain at least one **generator-eligible** item. Eligibility is the **canonical predicate** shared by:

1. `workout_catalog_release_eligible_item_count` (DB) / DRAFT→PUBLISHED validation  
2. `WorkoutCatalogReleaseService.assertReleasePublishable`  
3. `WorkoutCatalogReleaseService.listGeneratorEligibleExercises` (also requires `release.status = PUBLISHED`)

Canonical item predicate:

- `enabledForGenerator = true`
- pinned revision `status = APPROVED`
- `revision.exerciseId = item.exerciseId`
- `Exercise.id = item.exerciseId` (join)
- `item.familyId` IS NOT DISTINCT FROM `Exercise.familyId`
- `Exercise.isActive = true`
- `Exercise.key IS NOT NULL`

Raw item row count is not enough: only-disabled or only-null-key releases are `WORKOUT_CATALOG_RELEASE_EMPTY` at publish time. Null-key companions alongside ≥1 valid eligible item are allowed (they simply do not count).

Post-publish, DB guards prevent emptying eligibility via:

- `APPROVED → RETIRED` on a revision pinned by the current PUBLISHED release
- `Exercise.isActive true → false` for generator-enabled published items
- `Exercise.key` change (including → NULL) while pinned by generator-enabled published items (`EXERCISE_KEY_PUBLISHED_RELEASE_PINNED`); after first approval/release use, key is permanently immutable (`EXERCISE_KEY_IMMUTABLE`) — see identity ADR
- mutating published release items

Publication of a new DRAFT is an **atomic retire + publish** inside one DB transaction under `pg_advisory_xact_lock(21000101)`:

1. validate candidate DRAFT (≥1 eligible item, no structurally invalid items);
2. retire current `PUBLISHED` (if any);
3. publish candidate;
4. assert exactly one `PUBLISHED` row.

The same advisory lock is taken by DB eligibility mutations (revision retire / exercise deactivate / key change when identity-locked) and by DB publish validation so concurrent publish vs eligibility mutation cannot commit an invalid PUBLISHED release. Partial unique index on `PUBLISHED` remains the concurrency backstop.

`WorkoutCatalogReleaseItem.familyId` must equal `Exercise.familyId` at item insert/update and at publish. Once an exercise appears in any release item, `Exercise.familyId` is immutable so published history cannot be rewritten by identity reclassification.

## Consequences

- New plans store `workoutCatalogReleaseId` / `workoutCatalogReleaseCode`.
- Changing catalog content requires a new DRAFT release + atomic publish.
- At most one PUBLISHED release at a time (partial unique index + advisory lock).
- Empty, only-disabled, only-null-key, or non-eligible direct SQL `DRAFT→PUBLISHED` is rejected by DB triggers.
- Retirement of live revisions requires replacing/retiring the PUBLISHED release first.
- Identity drift via `Exercise.key` cannot empty a live PUBLISHED generator selection.
