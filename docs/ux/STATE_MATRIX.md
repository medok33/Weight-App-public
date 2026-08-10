# V10 production state matrix

| Surface | State / trigger | Visible information and action | Claim rule |
|---|---|---|---|
| Today | LOADING, EMPTY, PARTIAL_DATA, STALE, RECALCULATING, ERROR, OFFLINE | Explain what is available; retry or continue with safe known data | Stale/cache is labelled, never current |
| Meal / recipe | SUCCESS, COMPLETED, EMPTY, ERROR, PROVIDER_UNAVAILABLE | Open recipe, retry image, confirm completion only after receipt | Planned is not completed |
| Workout | READY, RESUMED, COMPLETED, MISSED, RESCHEDULED, PERMISSION_DENIED | Start/resume/alternative/retry | Session owner determines outcome |
| Shopping / basket | SUCCESS, PARTIAL_DATA, PRICE_DATA_INCOMPLETE, RECALCULATING | View list, retry, show estimate/reference label | No live stock/price claim from reference |
| Budget | BUDGET_INFEASIBLE, BUDGET_ESTIMATE_UNRELIABLE, OVER_BUDGET_PREVIEW | Change non-hard preference or explicitly accept delta | Never says fits without evidence |
| Progress | SUCCESS, PARTIAL_DATA, STALE, EMPTY | Show conclusion or insufficient-data recovery | No significant trend without history |
| Profile | VALIDATION_ERROR, PERMISSION_DENIED, RECOVERY_AVAILABLE, RECOVERY_UNAVAILABLE | Correct input, sign in, recovery path | User copy avoids internal cause |

`LOADING`, `EMPTY`, `SUCCESS`, `PARTIAL_DATA`, `STALE`, `OFFLINE`, `ERROR`, `VALIDATION_ERROR`, `PERMISSION_DENIED`, and `PROVIDER_UNAVAILABLE` are shared states. Cached factual values may appear only with timestamp/freshness and only when their owner permits it.
