# V10 production state matrix

Each row is limited to applicable combinations. “Cached” means owner-approved value with timestamp/freshness; retry never implies command success.

| Surface | State / trigger | Visible information / message | Primary / secondary action | Blocking, cache, claims and recovery |
|---|---|---|---|---|
| Today | `LOADING`; next action unresolved | Skeleton, “preparing today”; no invented action | Wait / leave | Decision CTA blocks; cache only when labelled; retry owner fetch |
| Today | `EMPTY`; no actionable plan | Explain absence and safe next step | Set plan / browse Plan | No completion claim; owner setup recovers |
| Today | `PARTIAL_DATA`, `STALE`, `OFFLINE` | Dated available cards separate from unavailable sections | Refresh / continue safe known data | Safe actions only; timestamped cache; never current/live |
| Today | `RECALCULATING`, `ERROR`, `PERMISSION_DENIED` | Pending, plain error or permission explanation | Wait/retry/grant / return | Affected CTA blocks; explicit recovery |
| Meal | `LOADING`, `EMPTY`, `SUCCESS` | Distinct planned meal kind or absence | Open recipe / accepted plan action | Completion blocks while loading; planned is not completed |
| Meal | `COMPLETED`, `PARTIAL_DATA`, `ERROR`, `OFFLINE` | Completion after canonical receipt; absent image/nutrition labelled | View/retry / continue known data | Owner receipt required; cache timestamped |
| Recipe / Cook | `SUCCESS`, no-image, `PROVIDER_UNAVAILABLE` | Ingredients/steps or no-image fallback | Start/continue Cook / retry media | Cook remains usable; media proves nothing factual |
| Recipe / Cook | `LOADING`, `ERROR`, `OFFLINE`, `VALIDATION_ERROR` | Unavailable step/data and corrective message | Retry / return | Affected action blocks; no invented nutrition; preserve confirmed step only if owner permits |
| Workout | `PLANNED`, `IN_PROGRESS`, `PARTIALLY_COMPLETED`, `COMPLETED` | Next workout, exercise list/detail and session state | Start/resume/acknowledge / replace, skip, shorter, lighter | Owner session state; partial is not complete; no manual set/rep default |
| Workout | `MISSED`, `RESCHEDULED`, no workout today | Neutral outcome explanation | Move, recovery, shorter/lighter or skip / view week | No refusal reason; owner-backed alternative |
| Workout | `LOADING`, `ERROR`, `OFFLINE`, `PERMISSION_DENIED` | Status and availability boundary | Retry/grant / return | Command blocks; cached session labelled; no inferred completion |
| Shopping | `SUCCESS`, known/unknown inventory, price or store | Required vs package quantity and owner certainty/provenance | Add/open Basket / edit list | No inventory/price claim without owner field |
| Shopping | `EMPTY`, acquired item | Empty list is not “nothing to buy”; acquisition is item state | Generate/review / return | No plan-completion inference |
| Shopping | `PARTIAL_DATA`, `STALE`, `OFFLINE`, `ERROR` | Missing/dated price, inventory or store labelled | Refresh / continue list | Basket transition may block; cache timestamped |
| Basket | `EMPTY` | Explain absent purchase estimate | Return to shopping / dismiss | No payable total |
| Basket | `SUCCESS`, reference/confirmed amount | Package/purchase quantity, store, match confidence, substitution and override | Preview/update / remove or change | Provenance label mandatory; reference never looks live |
| Basket | `PARTIAL_DATA`, `PRICE_DATA_INCOMPLETE`, `STALE`, `OFFLINE` | Unavailable/stale price or package match; total pending/unknown | Refresh/recalculate / substitute, remove, list | Exact total and budget conclusion block; no within/over claim |
| Basket | `RECALCULATING`, `BASKET_ALTERNATIVES_UNAVAILABLE`, `NO_VALID_RETAIL_OFFER`, `ERROR` | Pending rebuild or explicit lack of alternative/offer | Wait/retry / retain list or change non-hard preference | Existing result never silently retained; owner recovery only |
| Budget | `BUDGET_OK` | Feasible estimate, scope and confidence | Continue labelled estimate / inspect basket | Not payable/live; recalculate after affecting change |
| Budget | `BUDGET_INFEASIBLE` | Owner says target cannot be met | Change non-hard preference / explicitly accept delta | Blocks “within budget”; not missing-price state |
| Budget | `BUDGET_ESTIMATE_UNRELIABLE`, `PRICE_DATA_INCOMPLETE` | Confidence/evidence limitation, not over-budget | Refresh/substitute / review list | Budget conclusion blocks; no within/over claim |
| Budget | `OVER_BUDGET_PREVIEW`, `RECOVERY_AVAILABLE`, `RECOVERY_UNAVAILABLE` | Calculated preview or honest recovery availability | Change/accept or recover / return | Explicit accept; unavailable recovery fabricates no total |
| Progress | `SUCCESS`, `PARTIAL_DATA`, `STALE`, `EMPTY` | Conclusion, possible reason, trend, action; sufficiency/freshness | Record/view / retry | No causal conclusion without history; dated cache allowed |
| Progress | `ERROR`, `OFFLINE`, `PERMISSION_DENIED` | Missing source and recovery explanation | Retry/grant / return | Data blocks; never current steps/trend without owner value |
| Profile / settings | `SUCCESS`, `VALIDATION_ERROR` | Profile/goal/preferences/stores, supported loyalty, sessions/privacy/export/deletion/activity/subscription | Save correction / discard | Save only blocks; confirmation requires receipt |
| Profile / settings | `PARTIAL_DATA`, `PERMISSION_DENIED`, `RECOVERY_AVAILABLE`, `RECOVERY_UNAVAILABLE`, `ERROR` | Per-section availability and plain recovery | Retry/grant/recover / keep available settings | No OWNER/admin/TOTP/QR operation; stale account values labelled |
