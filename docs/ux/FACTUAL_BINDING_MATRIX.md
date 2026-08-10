# V10 factual UI binding matrix

**Rule: NO DOMAIN FIELD => NO FACTUAL UI CLAIM.**

| Claim group | Required owner field/state | Fallback / forbidden fallback |
|---|---|---|
| Meal upcoming/completed, calories/protein target | Plan/meal-completion and nutrition snapshot | “Planned”/unknown; never completion checkmark without receipt |
| Workout scheduled/completed/partial/no-workout | Workout plan/session status | Alternative/unknown; never inferred from UI tap |
| Weight/trend/steps/activity source/sync | Progress/activity value, source, observed time, sufficiency | Timestamped unavailable; never live/current implication |
| Energy estimate | Workout energy value plus estimate status/version | “Estimate unavailable”; never fabricate kcal |
| At-home product/nothing to buy/quantity | Pantry/shopping owner state | “Check list”; never infer inventory |
| Reference price/store/price freshness/price confidence | Price snapshot provenance, observed time, price-confidence state, store scope | “Reference/unknown”; never live availability |
| Product/package match confidence | Product/package/variant match owner state | Uncertain match; never promote a numeric observation to reliable price evidence |
| `PlanReferenceCostEstimate` | Plan-level reference estimate with provenance and freshness | Planning/comparison only; never reuse as Basket payable amount |
| `BasketPurchaseEstimate` / reliable whole-basket total | Current basket quantities plus applicable price evidence; full required-line coverage for reliable total | Partial/estimated/unavailable; known-line subtotal never masquerades as complete total |
| Recalculation pending | Explicit rebuild/status state | Pending label; never silently retain old result |
