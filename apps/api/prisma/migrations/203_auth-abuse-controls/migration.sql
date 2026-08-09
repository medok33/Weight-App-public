-- ARCH-SEC-02B: PostgreSQL-authoritative auth throttling and temporary account lockout.
-- Forward-only and non-destructive; existing User/Session data is untouched.

CREATE TABLE IF NOT EXISTS "AuthThrottleBucket" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "action" TEXT NOT NULL CHECK ("action" IN ('login', 'register', 'password_reset')),
  "subjectType" TEXT NOT NULL CHECK ("subjectType" IN ('account', 'ip', 'account_ip')),
  "subjectHash" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failureCount" INTEGER NOT NULL DEFAULT 0 CHECK ("failureCount" >= 0),
  "blockedUntil" TIMESTAMPTZ,
  "lastFailureAt" TIMESTAMPTZ,
  "successClearedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthThrottleBucket_action_subject_unique" UNIQUE ("action", "subjectType", "subjectHash")
);

CREATE INDEX IF NOT EXISTS "AuthThrottleBucket_lookup_idx"
  ON "AuthThrottleBucket" ("action", "subjectType", "subjectHash", "blockedUntil");

CREATE INDEX IF NOT EXISTS "AuthThrottleBucket_expiry_idx"
  ON "AuthThrottleBucket" ("blockedUntil", "windowStartedAt");

CREATE TABLE IF NOT EXISTS "AuthAccountLockout" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountHash" TEXT NOT NULL UNIQUE,
  "failureCount" INTEGER NOT NULL DEFAULT 0 CHECK ("failureCount" >= 0),
  "lockedUntil" TIMESTAMPTZ,
  "lastFailureAt" TIMESTAMPTZ,
  "recoveredAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuthAccountLockout_lockedUntil_idx"
  ON "AuthAccountLockout" ("lockedUntil");

CREATE INDEX IF NOT EXISTS "AuthAccountLockout_updatedAt_idx"
  ON "AuthAccountLockout" ("updatedAt");
