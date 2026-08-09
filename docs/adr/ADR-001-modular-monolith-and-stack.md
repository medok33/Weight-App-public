# ADR-001: модульный монолит и базовый стек

- Статус: Accepted
- Дата: 2026-07-19
- Feature ID: PLATFORM
- Scope: foundation

## Контекст

MVP должен быстро развиваться небольшой командой, сохранять строгие границы между web, API, доменом и persistence и оставаться переносимым с локального компьютера на VPS. Бизнес-правила снижения веса и safety-решения должны быть воспроизводимыми и не зависеть от AI.

## Решение

Используем monorepo на `pnpm workspaces` и Turborepo:

- `apps/web`: Next.js App Router, TypeScript, React и UI-состояния;
- `apps/api`: NestJS modular monolith, REST JSON `/api/v1`;
- `apps/worker`: фоновые jobs, outbox polling, генерация планов и exports;
- `packages/domain`: чистые типы, policy и deterministic rules;
- `packages/contracts`: DTO, schemas и API contracts;
- `packages/ui`: reusable components и design tokens;
- PostgreSQL + Prisma: system of record;
- PostgreSQL Outbox + worker polling в MVP; Redis/BullMQ только после ADR и измеренной необходимости;
- S3-compatible private storage для PDF и других бинарных объектов;
- provider-neutral AI Gateway с первым DeepSeek adapter.

## Границы

`apps/web` не содержит серверных формул и не обращается к Prisma. `apps/api` не содержит UI. `packages/domain` не импортирует NestJS, Prisma, Redis, React или HTTP SDK. Controller только валидирует boundary и вызывает application service. Repository скрывает persistence. Внешние provider adapters не проникают в domain.

Критические числа (BMR, TDEE, deficit, protein, eligibility и guardrails) считает код. Каталоги ограничивают продукты, рецепты и упражнения. AI объясняет проверенный результат и не является source of truth.

## Проверка и последствия

Проверки foundation: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Локальная инфраструктура запускается через Docker Compose после установки Docker Desktop; перенос на VPS выполняется теми же контейнерными конфигурациями и `.env`-схемой.

Положительные последствия: простая локальная разработка и deploy, чёткие ownership boundaries, транзакционная целостность и воспроизводимые расчёты. Негативные последствия: требуется дисциплина модулей, миграций, contracts и registry.

## Отложенные решения

Платёжный провайдер, legal texts, регион цен, конкретные provider credentials и production VPS не фиксируются этим ADR. Внешние auth providers описываются в AUTH ADR и реализуются через `AuthIdentity` и server-side verification.

