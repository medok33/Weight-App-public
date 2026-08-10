# UX-01 — V10 Core Flow Contract

## Authority and scope

**Authoritative visual source:** `WEIGHT_APP_V10_INTERACTIVE_PROTOTYPE_HANDOFF.zip`, including `HANDOFF_TO_CURSOR.md`, `app/globals.css`, and its deployed checkpoint. Product/domain authority remains Master Plan V3.3 and accepted API contracts. Prototype-local state is never production truth.

`WEIGHT_APP_V8_5_FINAL_DIRECTION_REPORT` and all V8.5 prototypes are **SUPERSEDED_REFERENCE**: they may inform historical comparison only, never tokens, responsive rules, or production components.

This contract freezes core USER presentation only. It does not change APIs, database, domain algorithms, OWNER/admin, Assistant, generated media, or live retailer behaviour.

## Tokens

| Group | Frozen V10 value |
|---|---|
| Background / deep | `#f7f8f6` / `#ecefeb` |
| Text / muted / line | `#17201c` / `#6d746f` / `rgba(23,32,28,.13)` |
| Primary / secondary accent | `#173d31` / `#2e6650` |
| Supporting surfaces | white, `#dcecdf`, `#cfe3a8`, `#eacdb6`, restrained glass only for nav |
| Danger / focus | `#a7433c` / 3px green focus ring |
| Type | Geist/system sans; editorial display, compact hierarchy, no dashboard-density |
| Radius | control pill; surfaces 28px; media 36px/12px asymmetric only where V10 specifies |
| Motion | `.2–.38s` V10 ease; reduced motion removes decorative transition |
| Safe area | mobile content reserves `env(safe-area-inset-bottom)` above five-tab bar |

Exact unrepresented values are `TBD_OWNER_VISUAL`, not inferred.

## Information architecture and Today

Mobile primary navigation: **Сегодня, План, Прогресс, Помощник, Профиль**. Plan contains **Питание, Тренировки, Покупки**. Desktop keeps this architecture in its sidebar/compact rail.

Today order is immutable: **next action → why now → one primary CTA → short metrics → related meal/workout → progress**. It is never an analytics dashboard. States: `READY`, `LOADING`, `EMPTY`, `PARTIAL_DATA`, `STALE`, `RECALCULATING`, `COMPLETED`, `MISSED`, `RESCHEDULED`, `OFFLINE`, `PERMISSION_DENIED`, `ERROR`; backend states must be mapped explicitly.

## Core screen contracts

| Surface | Rule |
|---|---|
| Meal / recipe | Breakfast/lunch/dinner/snack remain distinct; completion mark only after confirmed completion; no-image recipe state is first-class. |
| Cook mode | Sequential accessible steps, completion confirmation, portion/nutrition only from canonical data. |
| Workout | Start/resume/replace/skip/shorter/recovery/complete; no mandatory manual sets/reps logging; “today without workout” needs no refusal reason. |
| Shopping / basket | Distinguish known vs uncertain inventory; reference/estimated price is never live availability; show package quantity, delta, over-budget preview, and recalculation. |
| Budget | `BUDGET_OK`, `BUDGET_INFEASIBLE`, `BUDGET_ESTIMATE_UNRELIABLE`, `OVER_BUDGET_PREVIEW`, `PRICE_DATA_INCOMPLETE`, `RECOVERY_*`; insufficient price evidence cannot say “fits budget”. |
| Progress | conclusion → possible reason → trend → action; insufficient/stale data stays explicit. |
| Profile/privacy | Profile, goal, preferences, stores, sessions, export/deletion and activity source surfaces; OWNER redesign excluded. |

## Factual binding and states

No domain field means no factual UI claim. Completion requires canonical meal/workout completion; weight/trend require progress data and sufficiency state; calories/protein/energy require their respective calculation metadata; inventory, “nothing to buy”, basket total, store, price freshness/confidence and activity sync require explicit owner fields. Unknown/unavailable values render as unknown, never as success.

All significant screens support loading, empty, success, partial, stale, offline, error, validation error, permission denied, provider unavailable, completed, missed, rescheduled, recalculating; recovery is a clear action without engineering jargon.

## Responsive, accessibility, motion

V10 breakpoints: `<=760` mobile top bar + fixed tabs; `761–1023` compact rail; `>=1024` persistent sidebar/editorial canvas. Validate 360/375/390/430, 768/834/1024, 1280/1440/1728. Mobile is independently composed: compact greeting, one dominant CTA, 44px targets, no bottom-nav overlap, readable long Russian text, no redundant checkmark+chevron, and images never split header/body awkwardly.

Keyboard contract: Tab/Shift+Tab, Enter/Space, Escape, appropriate arrows; visible focus, semantic headings, dialog focus trap/return, no hidden focus targets. Support 200% text, landscape, long Russian strings, contrast, and reduced motion without loss of meaning.

## Component inventory

`AppShell`, desktop/sidebar navigation, `MobileTabBar`, headers, primary/secondary action, status/metric, TodayNextAction/WhyNow, meal/image/recipe/cook, workout/exercise, shopping/basket/budget, progress/trend, empty/error/stale/offline/permission, sheet/dialog/toast, form/segmented/tabs/list/settings. Each consumes only its declared domain binding and has loading/empty/error/accessibility variants.

## Acceptance checklist

- V10 artifact source recorded; V8.5 superseded.
- One information architecture and Today hierarchy across responsive modes.
- Explicit state, factual-binding, mobile, accessibility, motion and no-image rules.
- Assistant/provider, generated media, backend/domain and OWNER redesign remain out of scope.
