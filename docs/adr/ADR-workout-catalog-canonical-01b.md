# ADR: Workout Catalog Canonical Content (01B)

## Status

Accepted for WORKOUT-CATALOG-01B (FIX 2 — no unsafe reactivation; persisted preferred graph; session revision switch).

## Context

01A shipped families, revisions, safety/provenance freeze, variant graph, and bootstrap release `workout-catalog-bootstrap-01a` with 20 APPROVED exercises. 01B publishes the full 84/36 canonical set via `workout-catalog-canonical-01b`. Independent review required an explicit field-ownership contract so customer-facing reads never silently fall back to the mutable Exercise hub.

## Decision

1. Keep the 01A schema; no new tables for content convenience.
2. Author one SoT JSON (`canonical-content-01b.json`) driving migration 211 and validation tests.
3. For the existing 20: add immutable revision 2 (never UPDATE frozen rev1).
4. For the 64: insert Exercise + revision 1 through DRAFT→safety→source→APPROVED.
5. Publish `workout-catalog-canonical-01b` under advisory lock `21000101`; retire bootstrap; keep exactly one PUBLISHED.
6. Store generator `movementPattern` via `GENERATOR_MOVEMENT_PATTERN` mapping so weekly skeletons continue to work.
7. Candidate edges are static content for 01D only; preferred = priority 0 and never HARDER.
8. **Content ownership (FIX 1):** `ExerciseRevision` is the source of truth for versioned customer-facing fields. `Exercise` is identity/filter hub only.

### Field ownership contract

| Field | Owner | Read path | Snapshot policy |
| --- | --- | --- | --- |
| `id` / `key` / `familyId` / `isActive` | Exercise hub | Hub (+ release membership) | Session may pin `sourceExerciseId` + `exerciseKey` |
| Filter tech fields (`riskLevel`, `movementPattern`, `difficulty`, `equipmentCodesJson`, `muscleGroupsJson`) | Exercise hub (identity filters) | Hub | Not required on session snapshot |
| Display name (`nameRu` / `nameEn`) | ExerciseRevision | PUBLISHED release → pinned revision | Snapshot `displayNameRu/En` at session create |
| `techniqueRu/En` | ExerciseRevision | Pinned revision only (no hub COALESCE) | Snapshot `techniqueSummaryRu/En` |
| `commonMistakeRu/En` | ExerciseRevision | Pinned revision only | Snapshot `commonMistakeRu/En` |
| `easierVariantRu/En` (guidance text) | ExerciseRevision | Pinned revision only | Snapshot guidance text; **never** substitute related exercise title |
| Preferred candidate relation | `ExerciseVariantRelation` (priority 0, EASIER/SAME_LEVEL) | Graph for 01D / `easierVariantKey` metadata | Not user-facing guidance |
| `breathingRu/En` | ExerciseRevision | Pinned revision only | Snapshot `breathingRu/En` |
| `stopConditionsRu/En` | ExerciseRevision | Pinned revision only | Snapshot `stopConditionsRu/En` |
| Safety profile / provenance | Revision-attached rows | Pinned revision | Not copied to session unless needed later |

### Forbidden

- Syncing revision back into hub as the primary read mechanism
- Hiding divergence with `COALESCE(hub, revision)` for mandatory revision content
- Treating hub fallback as normal when an APPROVED revision lacks mandatory fields (→ `WORKOUT_CATALOG_INTEGRITY_ERROR`)

### Read paths

1. Generator: `listGeneratorEligibleExercises` → PUBLISHED items → pinned APPROVED revision fields
2. Detail API: `getPublishedExerciseDetail` → same pin; controlled errors for missing release / not in release / integrity
3. New WorkoutSession: seeds from `getPublishedExerciseDetail`; historical sessions keep immutable snapshots

## Consequences

- Generator eligible set becomes 84.
- Algorithm stamp becomes `workout-catalog-01b.1`.
- Manifest inventory statuses: 20 `EXISTING_APPROVED` + 64 `CANONICAL_01B`.
- Media (01C) and adaptive replacements (01D) remain out of scope.
- Migration 211 adds session snapshot columns for breathing/stop. `RETIRED` remains terminal — there is **no** production `RETIRED→PUBLISHED` recovery path in the release guard or application service.
- Migration re-runs are ledger no-ops; they do **not** heal a corrupted zero-PUBLISHED state.
- Test isolation for publish/concurrency/adversarial suites uses disposable PostgreSQL databases (migrate 1–211, destroy in `finally`), not production reactivation helpers.
- Canonical `ExerciseVariantRelation` load uses `ON CONFLICT (…) DO UPDATE` for priority/levelDelta/active, then deletes only leftover non-SoT edges owned by canonical source keys so the persisted graph matches SoT.
- Session snapshots pin revision content at create time; publishing a newer revision affects only new sessions.