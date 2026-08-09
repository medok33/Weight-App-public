# AI Assistant Architecture

## Goal

User-facing goal-first coach with pluggable AI providers. No coupling to a single vendor.

## Provider layer

```
AIProviderAdapter
 ├── LocalProvider      (mock — tests / explicit AI_PROVIDER=local)
 ├── DeepSeekProvider   (DEEPSEEK_API_KEY + V4 models)
 ├── OpenAIProvider     (OPENAI_API_KEY + OPENAI_MODEL)
 └── LocalLlmProvider   (LOCAL_LLM_BASE_URL — Ollama-compatible)
```

Select via `AI_PROVIDER=local|deepseek|openai|local-llm`.

When `AI_PROVIDER=deepseek` and the key is set, requests go to DeepSeek. LocalProvider is **not** a silent fallback.

OWNER (development) may see provider/model/configured status via usage/provider-status — never the API key.

## Conversation pipeline

1. Load last 8–12 messages  
2. `ConversationContextResolver` → entities, follow-up hints, parent topic  
3. Intent classifier (message + history + Goal Core signals)  
4. Quota gate (skip for greeting / refusal / offtopic)  
5. Context pack (`selectTopicContext`) + system prompt  
6. Provider call → usage log  

## Context Engine

`AIContextBuilder.buildSnapshot()` aggregates domain services, then builds **Goal Core**.

`selectTopicContext(topic)` packs only relevant extras into the system prompt:

- Goal Core — always  
- NUTRITION / TRAINING / PROGRESS / SHOPPING / PUBLIC_FITNESS_KNOWLEDGE / celebrity domains — by topic  

`buildSystemPrompt()` includes:
- response stages (answer → applicability → goal → action when useful)  
- FREE/PREMIUM capability instructions  
- celebrity / workout-program / shopping-price instructions  
- goal-pace caution when `AGGRESSIVE`  
- medical disclaimer flag when clinical  

`dataVersion` = `2`.

## Business Logic Layer

| Piece | Behavior |
|-------|----------|
| Tariffs | FREE 20/day flash; PREMIUM 30/day pro; OWNER unlimited (`quotaMode=UNLIMITED`) |
| Usage | `AIUsageLog` always on successful LLM turns (incl. OWNER) |
| Router | tariff model + complexity |
| Intent | history-aware topics incl. FOOD_PRODUCT, FOLLOW_UP, CELEBRITY_*, GREETING |
| Medical | soft disclaimer; never blocks lifestyle questions |
| Style | goal-first; short by default; detailed only when asked |

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /assistant/messages` | Start chat / send first message |
| `POST /assistant/conversations/:id/messages` | Continue thread |
| `GET /assistant/conversations` | List threads |
| `GET /assistant/context` | Snapshot + Goal Core |
| `GET /assistant/usage` | `quotaMode`, `limit`, `used`, `remaining` |
| `GET /assistant/provider-status` | provider/model/configured (no secrets) |
| `GET/POST /assistant/owner-control` | Kill switch (owner MFA) |

## Security

- Session auth via `wa_session`  
- Kill switch  
- Injection detection  
- Minimized health fields in context  

See also: `AI_ASSISTANT_POLICY.md`.
