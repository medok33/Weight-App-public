# ADR: Canonical custom SQL migration runner

**Status:** Accepted  
**Date:** 2026-07-23  
**Package:** Remediation Package A

## Context

The repository stores PostgreSQL DDL under `apps/api/prisma/migrations/<NNN_name>/migration.sql` and uses `schema.prisma` as the model source of truth. Runtime access is via `pg`, not Prisma Client. There is no `migration_lock.toml` and no `_prisma_migrations` history. Ad-hoc scripts (`apply-*.mjs`) previously applied subsets of SQL without checksums or locking. Eight migration folders (`094`, `095`, `136`–`141`) existed on disk but were untracked, breaking clean-clone bootstrap.

## Decision

**Canonical mechanism = custom SQL migration runner** (`apps/api/scripts/migrate.mjs` + `scripts/lib/sql-migration-runner.mjs`).

Do **not** introduce Prisma Migrate in parallel.

## Consequences

| Concern | Behavior |
|---------|----------|
| Exactly-once | Row in `SchemaMigrationLedger` per migration name |
| Checksum | SHA-256 of SQL with CRLF normalized to LF; mismatch → hard fail |
| Concurrency | `pg_advisory_lock(88442201)` around apply |
| Repeat run | No-op when ledger checksum matches file |
| Late lower number | Hard fail when an unledgered migration number is lower than the highest applied number |
| Legacy DB | `pnpm db:migrate:baseline` records checksums without re-executing SQL |
| CI gates | `pnpm db:check-migrations` — unique numbers + no untracked migration folders |
| Prisma Client | Not required for migrate; `schema.prisma` documents models including `SchemaMigrationLedger` |

## Commands

```bash
pnpm db:check-migrations
DATABASE_URL=... pnpm db:migrate
DATABASE_URL=... pnpm db:migrate:status
DATABASE_URL=... pnpm db:migrate:baseline   # existing manually migrated DB only
```

## Frozen 222/223 decision

Migration `223_price_reference_core` may be applied while the old, unmerged Assistant
Brain migration numbered 222 is absent. That gap is valid. Once 223 is present in an
environment ledger, a migration numbered 222 must never be introduced later: the
runner rejects it as `MIGRATION_LATE_INSERTION`. At Assistant Brain re-entry its old
222 migration must be renumbered to the next free number at that future baseline and
its branch tests/checksums updated. No placeholder 222 is created.
