# AI Assistant Policy

## Goal-first personalization

Every allowed LLM turn receives **Goal Core** from PostgreSQL (profile + goal + progress):

| Field | Source |
|-------|--------|
| `primaryGoal` | `UserGoal.kind` |
| `currentWeight` | progress latest → else profile `weightKg` |
| `targetWeight` | `UserGoal.target` when `unit=kg` |
| `targetDate` | profile / goal `targetDate` (null if unset) |
| `activityLevel` | profile |
| `trainingLevel` | `BEGINNER` \| `INTERMEDIATE` \| `ADVANCED` (null if unset) |
| `workoutsPerWeek` | profile field, else derived from workout plan day count |
| `dietaryPreferences` / `foodRestrictions` / `availableEquipment` | profile (null if unset) |

Unset fields stay `null` — never invent them. Ask short clarifying questions when a full program needs missing data.

Goal Core is the primary personalization anchor. Do not dump the full questionnaire into every simple reply.

### Response stages (prompt contract)

1. Answer the question directly  
2. Applicability to this user (only when useful)  
3. Link to Goal Core (only when useful)  
4. One short practical action (only when useful)  

Simple product/greeting questions: 2–5 short paragraphs; no forced “анкета в каждом ответе”.

### Goal pace evaluation

`weeksUntilTarget = daysUntilTarget / 7`  
`requiredChangePerWeek = abs(currentWeight − targetWeight) / weeksUntilTarget`

Caution threshold: `GOAL_WEIGHT_CHANGE_CAUTION_KG_PER_WEEK` (default `1`).

Statuses: `ON_TRACK` | `AGGRESSIVE` | `CONFLICTING` | `INSUFFICIENT_DATA`.

Example: 90 → 85 kg in ~30 days → `AGGRESSIVE` by weekly pace (not by absolute ≥8 kg). Never auto-change the goal; explain pace and suggest a safer strategy without crash diets.

## Conversation context

`ConversationContextResolver` runs **before** intent classification with:

- current message  
- last 8–12 messages  
- entities from the last assistant reply  
- selected conversation topic  
- Goal Core  

Follow-ups (“это”, “замени”, “мне не нравится”, product names from history) stay on the allowed parent topic — not off-topic.

## Allowed topics

`FOOD_PRODUCT`, `NUTRITION`, `SPORTS_NUTRITION`, `WEIGHT_GOAL`, `TRAINING`, `WORKOUT_PLAN`, `PROGRESS`, `SHOPPING`, `PRICE`, `HEALTHY_HABITS`, `PLAN_EXPLANATION`, `PUBLIC_FITNESS_KNOWLEDGE`, `CELEBRITY_TRAINING`, `CELEBRITY_DIET`, `FOLLOW_UP`, `GREETING`, plus `CLARIFY` / `OFFTOPIC`.

Low confidence → one short clarifying question, not an automatic refusal.

### Examples

| Message | Intent |
|---------|--------|
| «Что такое киноа?» | `FOOD_PRODUCT`, allowed |
| «Мне не нравится киноа, чем заменить?» | `FOLLOW_UP` + `FOOD_PRODUCT` |
| «Как тренировался Шварценеггер?» | `CELEBRITY_TRAINING` |
| «Собери продукты на неделю» | `SHOPPING` |
| «Привет» | `GREETING` (canned; no quota) |

## Tariffs

| Tier | Model | Daily successful requests | quotaMode |
|------|-------|---------------------------|-----------|
| FREE | `deepseek-v4-flash` | 20 | LIMITED |
| PREMIUM | `deepseek-v4-pro` | 30 | LIMITED |
| OWNER (`accountRole=OWNER`) | PREMIUM capabilities | none | **UNLIMITED** |

OWNER never receives `AI_DAILY_LIMIT_EXCEEDED`. Usage/cost still logged in `AIUsageLog`.

Quota payload:

```json
{ "quotaMode": "UNLIMITED", "limit": null, "used": 100, "remaining": null }
```

or LIMITED with numeric `limit` / `remaining`.

Does **not** burn quota: `GREETING`, policy refusal, off-topic refusal, clarify-only turns without LLM.

### FREE vs PREMIUM capabilities

- FREE: real LLM (not template bank); short goal-linked answers; basic nutrition/training/progress/habits; simple one-day workout; no multi-week celebrity program adaptation  
- PREMIUM/OWNER: programs, methodology comparison, public athlete knowledge with “по публично известным данным”, adaptation to Goal Core  

Celebrity answers must separate public knowledge, uncertainty, and assistant-built adaptation. Do not invent a day-by-day “exact” celebrity routine.

Workout programs: if `trainingLevel` / `workoutsPerWeek` / `availableEquipment` / restrictions / goal are missing, ask at most three short questions before building a detailed week plan.

Allowed FREE turns always call the configured provider (real LLM when `AI_PROVIDER=deepseek`). No silent LocalProvider fallback when DeepSeek is selected.

## Shopping and prices

Shopping answers use Meal Plan → Shopping List → Product → PriceObservation. Each price carries `retailer`, `sourceType`, `collectedAt`. Missing prices are stated as missing or approximate — never invented exact weekly budgets when items lack prices.

## Medical safety

Lifestyle nutrition questions stay open. Clinical signals (symptoms, diagnosis, disease, medicines, treatment) append:

> Информация носит общий ознакомительный характер и не заменяет консультацию врача.

No diagnoses, no prescriptions. Requests are not blocked solely for medical wording. Do not add the disclaimer to every ordinary product question.
