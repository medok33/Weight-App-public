# V10 component matrix

All components support loading/error/disabled where relevant, visible focus, semantic labels, and no factual claim without the declared binding.

| Component | Purpose / variants | Responsive behavior | Data / factual risk |
|---|---|---|---|
| AppShell, TopNavigation, DesktopSidebar, MobileTabBar | Same five-destination IA; active/disabled | Sidebar >=1024, rail 761–1023, tabs <=760 | Route/authorization state only |
| PageHeader, SectionHeader, Metric, StatusBadge | Hierarchy and short state | Compact mobile hierarchy | Metric/status needs owner field |
| PrimaryAction, SecondaryAction, Toast, InlineFeedback | One dominant action; confirm/disabled | 44px target; wrap long RU text | Must not imply command success before receipt |
| TodayNextAction, WhyNow | Next action and factual reason | Decision first, metrics secondary | Server-owned action/reason only |
| MealRow, MealCard, MealImage, RecipeSummary, CookModeStep | Planned/completed meal and no-image fallback | Distinct rows; no awkward split image | Plan/completion/image availability only |
| WorkoutSummary, ExerciseRow | Start/resume/skip/replace/complete | No mandatory logging | Session state only |
| ShoppingItem, BasketItem, BudgetStatus | Quantity, price type, delta | Horizontal detail becomes labeled stack | Inventory/price/budget evidence required |
| ProgressInsight, TrendSurface | Conclusion then trend | Graph is subordinate | Sufficiency/freshness required |
| EmptyState, ErrorState, StaleState, OfflineState, PermissionState | Honest recovery | CTA remains reachable | Never expose engineering jargon |
| Sheet, Dialog, FormField, SegmentedControl, Tabs, ListRow, SettingsRow | Modal/input/list patterns | Bottom sheet mobile, dialog desktop | Focus trap/return; validation association |
