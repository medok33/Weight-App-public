# V10 component matrix

All components expose loading/error/disabled only where applicable, preserve visible focus and never make a factual claim without the declared owner binding.

| Component | Purpose / variants / valid states | Mobile / desktop behavior | Data, interaction and accessibility | Factual risk / notes |
|---|---|---|---|---|
| `AppShell`, `TopNavigation`, `DesktopSidebar`, `MobileTabBar` | Five-destination IA; active, disabled, authorized | Tabs <=760; rail 761–1023; sidebar >=1024 | Route + authorization; keyboard links, current-page name | No API route becomes a destination |
| `PageHeader`, `SectionHeader`, `Metric`, `StatusBadge` | Hierarchy, short metric/status; loading/unknown/stale | Compact hierarchy / editorial secondary metrics | Metric owner, semantic headings and accessible status name | Metric/status requires owner field + freshness |
| `PrimaryAction`, `SecondaryAction`, `Toast`, `InlineFeedback` | One dominant action; confirm, disabled, async/error | 44px wrap / aligned decision action | Command receipt, Enter/Space, live non-stealing status | Never imply success before receipt |
| `TodayNextAction`, `WhyNow` | Server-owned action/reason; ready/empty/stale/recalculating | First viewport / decision stays dominant | Today owner, meaningful label and dated cache | No invented recommendation or current reason |
| `MealRow`, `MealCard`, `MealImage`, `RecipeSummary`, `CookModeStep` | Planned/completed/no-image/cook step | Separate rows, image above/omitted / contained media | Plan, completion and image owner; sequential keyboard steps | Checkmark only canonical completion; media is optional |
| `WorkoutSummary`, `ExerciseRow` | Planned/in-progress/partial/complete/missed/rescheduled; replace/skip alternatives | Decision before list / list-detail layout | Session owner; buttons announce update; no mandatory logging | Partial is not completed |
| `ShoppingItem`, `BasketItem`, `BudgetStatus` | Quantity, price certainty, substitution, preview/recalculating | Labelled stack / comparison-friendly rows | Shopping/basket/budget owner; override/removal confirmation | Reference/stale/unknown never look live or payable |
| `ProgressInsight`, `TrendSurface` | Conclusion/reason/trend/action; insufficient/stale | Text before graph / graph subordinate | Progress sufficiency/freshness, accessible summary | No causal or current claim without owner data |
| `EmptyState`, `ErrorState`, `StaleState`, `OfflineState`, `PermissionState` | Honest recovery variants | CTA reachable / constrained alongside content | State + recovery owner, role/status message | No engineering jargon or false success fallback |
| `Sheet`, `Dialog` | Mobile sheet / desktop dialog; open, loading, validation, error | Bottom sheet / centered dialog | Focus trap, Escape, focus return, labelled title | Modal command state requires explicit receipt |
| `FormField`, `SegmentedControl`, `Tabs`, `ListRow`, `SettingsRow` | Input, selection, navigation, settings states | Full-width controls / compact grouped controls | Label/error association, arrows where relevant, disabled semantics | Settings values require profile/account owner; USER only |
