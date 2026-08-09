# Container diagram

| Container | Ответственность | Не делает |
|---|---|---|
| `apps/web` | маршруты, формы, состояния loading/empty/error/success/disabled, API client | не считает BMR/TDEE, не обращается к Prisma |
| `apps/api` | auth, profile, policies, plans, payments, contracts, authorization | не содержит UI и не вызывает provider SDK из domain |
| `apps/worker` | outbox, plan generation, exports, notifications, cleanup | не является source of truth без БД |
| `packages/domain` | deterministic rules, typed policies, invariants | не знает NestJS/Prisma/React/AI |
| `packages/contracts` | DTO, schemas, OpenAPI-facing contracts | не содержит persistence |
| `PostgreSQL` | транзакции, source of truth, migrations, outbox, audit | не хранит provider secrets в открытом виде |
| `AI Gateway` | redaction, budget, prompt/version, provider adapter, output validation | не принимает eligibility/payment/calculation decisions |
| `Object Storage` | private PDF/export objects и signed downloads | не хранит бизнес-метаданные вместо БД |

## Auth provider boundary

Каждый provider реализует adapter interface. Callback/mini-app launch сначала валидируется на API boundary, затем identity нормализуется в `AuthIdentity`, после чего application service создаёт или находит `User` и выдаёт собственную сессию. Конфликт identity возвращается как `CONFLICT_*`; silent account merge запрещён.

