# Revision Engine (STEP_100)

## Confirmation model
- Preview is application/UI state only — never written to `PlanRevision`.
- Confirm creates an append-only `confirmed` row and a new immutable plan version.
- No pending→confirmed UPDATE.

## API
- `POST /api/v1/plans/:planId/revisions/preview`
- `POST /api/v1/plans/:planId/revisions/confirm` (+ `Idempotency-Key` header)
- `POST /api/v1/plans/:planId/revisions/cancel`

## Idempotency
Stored on `PlanRevision.idempotencyKey` + `requestHash` (mig `168`). Same key+payload → replay; same key+different payload → `IDEMPOTENCY_KEY_REUSED`.

## UX
`PlanRevisionPanel` is embedded on meal-plan and workout-engine screens.
