-- 215: ACTIVITY-01A automatic provider steps sync foundation
-- Additive. Does not amend 1–214. Safe to re-run (IF NOT EXISTS).
-- Not applied to staging/production/shared DB in this package.
-- MANUAL source is intentionally absent.

-- ---------------------------------------------------------------------------
-- Sync client / source state (one row per USER + source + client instance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActivitySyncClient" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sourceType" text NOT NULL,
  "clientInstanceId" text NOT NULL,
  "lastAcceptedSequence" bigint NOT NULL DEFAULT 0,
  "lastSuccessfulSyncAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ActivitySyncClient_sourceType_check"
    CHECK ("sourceType" IN ('HEALTHKIT', 'HEALTH_CONNECT')),
  CONSTRAINT "ActivitySyncClient_clientInstanceId_check"
    CHECK (char_length("clientInstanceId") BETWEEN 8 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivitySyncClient_user_source_instance_uidx"
  ON "ActivitySyncClient" ("userId", "sourceType", "clientInstanceId");

CREATE INDEX IF NOT EXISTS "ActivitySyncClient_user_idx"
  ON "ActivitySyncClient" ("userId");

-- ---------------------------------------------------------------------------
-- Versioned daily provider snapshots (STEPS only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActivityDailySnapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sourceType" text NOT NULL,
  "syncClientId" uuid NOT NULL REFERENCES "ActivitySyncClient"(id) ON DELETE CASCADE,
  "metricType" text NOT NULL,
  "localDate" date NOT NULL,
  "timeZone" text NOT NULL,
  value integer NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,
  "sourceCalculatedAt" timestamptz NOT NULL,
  "receivedAt" timestamptz NOT NULL DEFAULT now(),
  "supersedesId" uuid NULL REFERENCES "ActivityDailySnapshot"(id) ON DELETE SET NULL,
  "supersededAt" timestamptz NULL,
  "syncOperationId" text NOT NULL,
  CONSTRAINT "ActivityDailySnapshot_sourceType_check"
    CHECK ("sourceType" IN ('HEALTHKIT', 'HEALTH_CONNECT')),
  CONSTRAINT "ActivityDailySnapshot_metricType_check"
    CHECK ("metricType" IN ('STEPS')),
  CONSTRAINT "ActivityDailySnapshot_status_check"
    CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  CONSTRAINT "ActivityDailySnapshot_value_check"
    CHECK (value >= 0),
  CONSTRAINT "ActivityDailySnapshot_version_check"
    CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivityDailySnapshot_active_uidx"
  ON "ActivityDailySnapshot" ("userId", "sourceType", "localDate", "metricType")
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "ActivityDailySnapshot_user_date_idx"
  ON "ActivityDailySnapshot" ("userId", "localDate");

CREATE INDEX IF NOT EXISTS "ActivityDailySnapshot_client_idx"
  ON "ActivityDailySnapshot" ("syncClientId", "receivedAt");

-- ---------------------------------------------------------------------------
-- Idempotent sync operations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActivitySyncOperation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sourceType" text NOT NULL,
  "syncClientId" uuid NOT NULL REFERENCES "ActivitySyncClient"(id) ON DELETE CASCADE,
  "operationId" text NOT NULL,
  sequence bigint NOT NULL,
  "payloadChecksum" text NOT NULL,
  status text NOT NULL,
  "responseSnapshot" jsonb NOT NULL,
  "receivedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ActivitySyncOperation_sourceType_check"
    CHECK ("sourceType" IN ('HEALTHKIT', 'HEALTH_CONNECT')),
  CONSTRAINT "ActivitySyncOperation_status_check"
    CHECK (status IN ('ACCEPTED', 'CONFLICT'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivitySyncOperation_scope_uidx"
  ON "ActivitySyncOperation" ("userId", "sourceType", "syncClientId", "operationId");

CREATE INDEX IF NOT EXISTS "ActivitySyncOperation_user_received_idx"
  ON "ActivitySyncOperation" ("userId", "receivedAt");

-- ---------------------------------------------------------------------------
-- Distributed Activity sync rate limit (per authenticated USER)
-- AuthThrottleBucket cannot be reused: its action CHECK is auth-scoped only.
-- Shared/distributed state in PostgreSQL (Redis is health-check only here).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActivitySyncRateBucket" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "windowStartedAt" timestamptz NOT NULL DEFAULT now(),
  "requestCount" integer NOT NULL DEFAULT 0,
  "blockedUntil" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ActivitySyncRateBucket_requestCount_check"
    CHECK ("requestCount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivitySyncRateBucket_user_uidx"
  ON "ActivitySyncRateBucket" ("userId");

CREATE INDEX IF NOT EXISTS "ActivitySyncRateBucket_blocked_idx"
  ON "ActivitySyncRateBucket" ("blockedUntil", "windowStartedAt");
