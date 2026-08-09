# Observability

FEATURE_ID: OBSERVABILITY

Owner-only operations dashboard:

- Structured logging with redaction (STEP_152)
- Metrics + traces snapshot (STEP_153)
- Alert rules + owner notifications (STEP_154)

Route: `/observability` (also mirrored under owner operations).
BFF: `/api/observability/operations`, `/api/observability/dashboard`.

States: loading | empty | error | forbidden | success.
No demo fixtures; data comes from `OwnerAuditEvent` via API.
