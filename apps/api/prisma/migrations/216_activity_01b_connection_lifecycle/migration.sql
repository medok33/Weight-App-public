-- 216: ACTIVITY-01B provider connection lifecycle & sync status
-- Additive. Does not amend 1–215. Safe to re-run (IF NOT EXISTS).
-- Not applied to staging/production/shared DB in this package.
-- MANUAL source is intentionally absent.
-- Disconnect must not delete snapshots/clients/operations.

-- ---------------------------------------------------------------------------
-- Provider-level connection (distinct from per-device ActivitySyncClient)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActivityProviderConnection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sourceType" text NOT NULL,
  status text NOT NULL,
  "connectedAt" timestamptz NULL,
  "disconnectedAt" timestamptz NULL,
  "lastSuccessfulSyncAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ActivityProviderConnection_sourceType_check"
    CHECK ("sourceType" IN ('HEALTHKIT', 'HEALTH_CONNECT')),
  CONSTRAINT "ActivityProviderConnection_status_check"
    CHECK (status IN ('CONNECTED', 'DISCONNECTED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivityProviderConnection_user_source_uidx"
  ON "ActivityProviderConnection" ("userId", "sourceType");

CREATE INDEX IF NOT EXISTS "ActivityProviderConnection_user_idx"
  ON "ActivityProviderConnection" ("userId");

CREATE INDEX IF NOT EXISTS "ActivityProviderConnection_status_idx"
  ON "ActivityProviderConnection" ("userId", status);

-- ---------------------------------------------------------------------------
-- Backfill: one CONNECTED row per existing (userId, sourceType) sync client
-- Idempotent: skip pairs that already have a connection row.
-- connectedAt = earliest ActivitySyncClient.createdAt for the pair
-- lastSuccessfulSyncAt = max client lastSuccessfulSyncAt (nullable)
-- ---------------------------------------------------------------------------
INSERT INTO "ActivityProviderConnection" (
  "userId",
  "sourceType",
  status,
  "connectedAt",
  "disconnectedAt",
  "lastSuccessfulSyncAt",
  "createdAt",
  "updatedAt"
)
SELECT
  c."userId",
  c."sourceType",
  'CONNECTED',
  MIN(c."createdAt"),
  NULL,
  MAX(c."lastSuccessfulSyncAt"),
  MIN(c."createdAt"),
  now()
FROM "ActivitySyncClient" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "ActivityProviderConnection" existing
  WHERE existing."userId" = c."userId"
    AND existing."sourceType" = c."sourceType"
)
GROUP BY c."userId", c."sourceType";
