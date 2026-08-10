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
| Workout | Show next workout, exercise list/detail and start/resume. Replace one exercise, skip, shorter and lighter/recovery alternatives are explicit. `PLANNED`, `IN_PROGRESS`, `PARTIALLY_COMPLETED`, `COMPLETED`, `SKIPPED`, `MISSED`, and `RESCHEDULED` are distinct; partial and full completion require the session owner acknowledgement. No mandatory manual sets/reps logging; “today without workout” offers move, shorter/lighter, recovery or skip without a refusal reason. |
| Shopping | Show required quantity separately from rounded/package quantity; inventory, price and store are each `KNOWN`, `UNKNOWN`, `REFERENCE`, `STALE`, or `UNAVAILABLE` only when their owner supplies that state. An acquired item is not a completion claim for the plan. Basket entry is an explicit transition, never an inferred purchase. |
| Basket | A future Basket is a purchase-estimate review, not checkout. `PlanReferenceCostEstimate` is a planning/reference plan value only; it is never the Basket payable estimate. `BasketPurchaseEstimate` is the primary Basket amount when current basket package/purchase quantities have applicable price evidence; it is estimated, not a live checkout charge. A reliable whole-basket total may appear as factual only when every required Basket line has sufficient monetary evidence; a known-lines amount with partial coverage is labelled partial/estimated or unavailable, never presented as a complete total. Each item shows package/purchase quantity, store scope, reference/confirmed amount only with provenance, substitution and user removal/override. `MATCH_CONFIDENCE` measures product/package identity; `PRICE_CONFIDENCE` measures suitability of monetary evidence for the Basket estimate/total; `PRICE_FRESHNESS` is its separate temporal dimension. None implies another and they must not collapse into one badge. Empty, partial, stale, offline, error and recalculating states keep uncertainty visible. Missing package match or price produces uncertainty. Whole-basket delta and `OVER_BUDGET_PREVIEW` are preview states, not payable facts. Primary recovery is refresh/recalculate when data permits; otherwise return to list or change a non-hard preference. |
| Budget | `BUDGET_OK` needs a feasible estimate and may continue with labelled estimates. `BUDGET_INFEASIBLE` means authoritative feasibility says the target cannot be met; offer a non-hard preference change or explicit acceptance. `BUDGET_ESTIMATE_UNRELIABLE` means an estimate exists but confidence is insufficient; it cannot say within/over budget. `PRICE_DATA_INCOMPLETE` means required evidence is missing; request refresh, substitution or list review. `OVER_BUDGET_PREVIEW` is a calculated preview requiring explicit accept/change. `RECOVERY_AVAILABLE` exposes the owning recovery action; `RECOVERY_UNAVAILABLE` explains the limit without a false total. Recalculation is required after an affecting change. |
| Progress | conclusion → possible reason → trend → action; insufficient/stale data stays explicit. |
| Profile/privacy | Profile, goal, preferences, supported stores/loyalty, account/session, privacy, export/deletion, connected activity sources and subscription where the accepted product exposes it. USER settings never expose OWNER/admin/security operations; no TOTP/QR flow is introduced. |

## Factual binding and states

No domain field means no factual UI claim. Completion requires canonical meal/workout completion; weight/trend require progress data and sufficiency state; calories/protein/energy require their respective calculation metadata; inventory, “nothing to buy”, basket total, store, price freshness/confidence and activity sync require explicit owner fields. Unknown/unavailable values render as unknown, never as success.

All significant screens support their applicable loading, empty, success, partial, stale, offline, error, validation error, permission denied, provider unavailable, completed, missed, rescheduled and recalculating states. The state matrix defines the trigger, claims, actions, cached-data and recovery policy; recovery is a clear action without engineering jargon.

## Responsive, accessibility, motion

V10 breakpoints: `<=760` mobile top bar + fixed tabs; `761–1023` compact rail; `>=1024` persistent sidebar/editorial canvas. Validate 360/375/390/430, 768/834/1024, 1280/1440/1728. Mobile is independently composed: compact greeting and next action occupy the first viewport; Why now is subordinate; one dominant CTA; 44px targets; safe-area clearance and keyboard avoidance keep final controls visible; no bottom-nav overlap; readable long Russian text; no redundant checkmark+chevron; and images never split header/body awkwardly. Sheets are the mobile modal default and dialogs are centered on larger widths.

Keyboard contract: Tab/Shift+Tab, Enter/Space, Escape and appropriate arrows follow visible logical focus order; visible focus, semantic headings and accessible names are mandatory. Dialogs/sheets trap focus and restore it to their trigger; no hidden focus targets. Async loading, success and error changes are announced without stealing focus; inputs associate labels, validation and error text; disabled controls expose disabled semantics. Support 200% text, landscape, long Russian strings, contrast, touch targets and reduced motion without loss of meaning. This is a contract, not a WCAG certification.

## Component inventory

`AppShell`, desktop/sidebar navigation, `MobileTabBar`, headers, primary/secondary action, status/metric, TodayNextAction/WhyNow, meal/image/recipe/cook, workout/exercise, shopping/basket/budget, progress/trend, empty/error/stale/offline/permission, sheet/dialog/toast, form/segmented/tabs/list/settings. Each consumes only its declared domain binding and has loading/empty/error/accessibility variants.

## Acceptance checklist

- V10 artifact source recorded; V8.5 superseded.
- One information architecture and Today hierarchy across responsive modes.
- Explicit state, factual-binding, mobile, accessibility, motion and no-image rules.
- Assistant/provider, generated media, backend/domain and OWNER redesign remain out of scope.

## Matrix index

Implementation must use the inspectable [component matrix](COMPONENT_MATRIX.md), [state matrix](STATE_MATRIX.md), [responsive matrix](RESPONSIVE_MATRIX.md), [factual binding matrix](FACTUAL_BINDING_MATRIX.md), [accessibility checklist](ACCESSIBILITY_CHECKLIST.md), and [acceptance checklist](ACCEPTANCE_CHECKLIST.md). The bounded [current frontend compatibility audit](CURRENT_FRONTEND_COMPATIBILITY_AUDIT.md) records existing-surface implementation gaps without changing this future contract. Those matrices are normative supplements to this contract.
