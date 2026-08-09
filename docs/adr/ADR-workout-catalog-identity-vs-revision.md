# ADR: Workout catalog identity vs revision

**Status:** Accepted for WORKOUT-CATALOG-01A  
**Date:** 2026-08-02

## Decision

Keep existing `Exercise` as the stable identity. Add `ExerciseRevision` for versioned owned content. Do not create a parallel ExerciseV2 table.

After first approval (`approvedAt` set / status APPROVED / membership in a release item), revision **content and provenance are permanently immutable**. The only legal post-approval transition is `APPROVED → RETIRED`, and only when the revision is **not** pinned by the current `PUBLISHED` release. `RETIRED` is terminal (no re-APPROVE, no content/provenance edits).

Permanent provenance freeze includes `ExerciseSourceReference` (INSERT/UPDATE/DELETE blocked under the same ever-approved marker).

`ExerciseSafetyProfile` cannot be inserted, updated, deleted, or reassigned after the same ever-approved marker — including the case where no safety row existed before approval.

### Exercise.key identity contract (FIX 3)

`Exercise.key` is a **stable identity** after first approval or any release membership:

- Once an exercise has an APPROVED/RETIRED revision (`approvedAt` set or status in that set) **or** appears in any `WorkoutCatalogReleaseItem`, `key` cannot change (null↔value or value↔value) — `EXERCISE_KEY_IMMUTABLE`.
- While the exercise is also pinned by a **generator-enabled item of the current PUBLISHED release**, the same mutation raises `EXERCISE_KEY_PUBLISHED_RELEASE_PINNED` and takes `pg_advisory_xact_lock(21000101)` so it serializes with publish.
- Exercises that are still pre-approval and not in any release may set or change `key` freely (including NULL → value).

`key IS NOT NULL` is part of the canonical generator eligibility predicate (see immutable-release ADR).

## Consequences

- Plans/sessions continue to FK `Exercise.id`.
- Public technique text remains readable from Exercise during transitional period.
- Content changes after approval require a new `revisionNumber`, never in-place mutation via RETIRE bypass.
- To retire a revision used by the live catalog: first publish a replacement release (or retire the current PUBLISHED release), then RETIRE the old revision.
- Identity drift via `key` cannot empty a live PUBLISHED generator selection.
