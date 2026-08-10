# V10 factual UI binding matrix

**Rule: NO DOMAIN FIELD => NO FACTUAL UI CLAIM.**

| Claim group | Required owner field/state | Fallback / forbidden fallback |
|---|---|---|
| Meal upcoming/completed, calories/protein target | Plan/meal-completion and nutrition snapshot | “Planned”/unknown; never completion checkmark without receipt |
| Workout scheduled/completed/partial/no-workout | Workout plan/session status | Alternative/unknown; never inferred from UI tap |
| Weight/trend/steps/activity source/sync | Progress/activity value, source, observed time, sufficiency | Timestamped unavailable; never live/current implication |
| Energy estimate | Workout energy value plus estimate status/version | “Estimate unavailable”; never fabricate kcal |
| At-home product/nothing to buy/quantity | Pantry/shopping owner state | “Check list”; never infer inventory |
| Reference price/store/freshness/confidence | Price snapshot provenance, observed time, confidence, store scope | “Reference/unknown”; never live availability |
| Basket total/estimated total/budget remaining/fits/over | Basket estimate and budget feasibility state | Pending/insufficient evidence; never reuse plan estimate as payable total |
| Recalculation pending | Explicit rebuild/status state | Pending label; never silently retain old result |
