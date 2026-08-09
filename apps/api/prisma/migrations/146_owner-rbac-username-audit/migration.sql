-- Username + account status for unified RBAC
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_lower_uidx"
  ON "User" (lower("username"))
  WHERE "username" IS NOT NULL;

-- Backfill username from email / AuthIdentity for existing password accounts
UPDATE "User" u
SET "username" = lower(ai."providerSubject")
FROM "AuthIdentity" ai
WHERE ai."userId" = u.id
  AND ai.provider = 'email'
  AND u."username" IS NULL
  AND ai."providerSubject" IS NOT NULL
  AND ai."providerSubject" <> '';

-- Structured audit log for OWNER cross-user access
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "targetUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "requestId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuditLog_owner_created_idx" ON "AuditLog" ("ownerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_target_created_idx" ON "AuditLog" ("targetUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog" ("action");
