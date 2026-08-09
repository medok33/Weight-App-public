# End-to-end acceptance suite (STEP_165)

FEATURE_ID: PLATFORM

Owner/operator checklist of critical beta paths. Route:
`/provesti-end-to-end-acceptance-suite`.

The screen probes `/api/health/ready` then lists scenarios (auth, dashboard, meal,
workout, progress, shopping, export, health). States: loading | empty | error | success.
