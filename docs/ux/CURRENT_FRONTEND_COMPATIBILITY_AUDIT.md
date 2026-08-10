# Current frontend compatibility audit

This is an audit of the accepted frontend at `55db37f`, not a V10 implementation plan. A classification records the minimum future presentation work; it does not reopen the frozen V10 product contract.

| Surface | Classification | Current implementation | V10 gap | Future package owner | Blocks UX-01 freeze |
|---|---|---|---|---|---|
| Auth | RESTYLE_REQUIRED | Sign-in, registration, session and privacy flows exist. | Apply V10 shell, tokens and responsive presentation. | Future frontend implementation | NO |
| Onboarding | RESTYLE_REQUIRED | Guard and wizard flow exist. | Apply V10 hierarchy, states and mobile composition. | Future frontend implementation | NO |
| Today / dashboard | PARTIAL_REWORK_REQUIRED | Dashboard has API-backed loading, empty, partial, error, goal, progress and activity states. | Recompose around the single server-owned next action and V10 decision-first order. | Future frontend implementation | NO |
| Meals | RESTYLE_REQUIRED | Meal-plan and dish-detail surfaces exist. | Apply V10 meal-card, no-image and completion presentation. | Future frontend implementation | NO |
| Recipe | RESTYLE_REQUIRED | Dish-detail surface exists. | Add V10 recipe/Cook-mode presentation without changing canonical data ownership. | Future frontend implementation | NO |
| Workout | PARTIAL_REWORK_REQUIRED | Plan, Today and session surfaces with explicit session states exist. | Adopt V10 workout hierarchy and make manual set/rep entry non-mandatory. | Future frontend implementation | NO |
| Shopping | PARTIAL_REWORK_REQUIRED | API-backed list, quantity, estimate and purchase state exist. | Add V10 inventory certainty, price provenance/freshness and recovery presentation. | Future frontend implementation | NO |
| Basket | NOT_IMPLEMENTED | Shopping totals are shown inside the list; no independent basket surface exists. | Implement the frozen basket/estimate/over-budget contract. | Future frontend implementation | NO |
| Progress | RESTYLE_REQUIRED | Progress surface and API-backed summaries exist. | Apply V10 conclusion-first, sufficiency and stale-data presentation. | Future frontend implementation | NO |
| Profile / settings | RESTYLE_REQUIRED | Profile, privacy and activity settings surfaces exist. | Apply V10 settings grouping and editorial presentation. | Future frontend implementation | NO |
| Navigation | LEGACY_CONTRADICTS_V10 | Current shell has a desktop sidebar and an in-flow mobile link list. | Replace with the frozen five-destination mobile tabs, compact rail and V10 desktop sidebar. | Future frontend implementation | NO |

## Static foundation observed

`apps/web/src/styles/globals.css` already has visible focus, a skip link, 44px mobile controls, small-screen overflow protection, and `prefers-reduced-motion`. These are partial runtime evidence for the current UI foundation only. They do not prove V10 screens, which remain future implementation work.

