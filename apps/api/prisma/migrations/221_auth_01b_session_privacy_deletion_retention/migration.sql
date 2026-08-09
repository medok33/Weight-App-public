-- AUTH-01B: durable session metadata, account deletion lifecycle, and owner-approved retention FKs.
-- Only retained-row actor/provenance or historical-account references are converted to nullable SET NULL.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deviceLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgentHash" TEXT;

CREATE INDEX IF NOT EXISTS "Session_userId_revokedAt_expiresAt_idx"
  ON "Session"("userId", "revokedAt", "expiresAt");

CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "blockedReason" TEXT,
  "retentionSummary" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_userId_requestedAt_idx"
  ON "AccountDeletionRequest"("userId", "requestedAt");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_status_requestedAt_idx"
  ON "AccountDeletionRequest"("status", "requestedAt");

ALTER TABLE "AccountDeletionRequest" DROP CONSTRAINT IF EXISTS "AccountDeletionRequest_userId_fkey";
ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaInvite" DROP CONSTRAINT IF EXISTS "BetaInvite_createdByUserId_fkey";
ALTER TABLE "BetaInvite" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "BetaInvite"
  ADD CONSTRAINT "BetaInvite_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OwnerAuditEvent" DROP CONSTRAINT IF EXISTS "OwnerAuditEvent_userId_fkey";
ALTER TABLE "OwnerAuditEvent" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "OwnerAuditEvent"
  ADD CONSTRAINT "OwnerAuditEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AIControl" DROP CONSTRAINT IF EXISTS "AIControl_updatedBy_fkey";
ALTER TABLE "AIControl" ALTER COLUMN "updatedBy" DROP NOT NULL;
ALTER TABLE "AIControl"
  ADD CONSTRAINT "AIControl_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeatureFlag" DROP CONSTRAINT IF EXISTS "FeatureFlag_updatedBy_fkey";
ALTER TABLE "FeatureFlag" ALTER COLUMN "updatedBy" DROP NOT NULL;
ALTER TABLE "FeatureFlag"
  ADD CONSTRAINT "FeatureFlag_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_userId_fkey";
ALTER TABLE "Payment" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Entitlement" DROP CONSTRAINT IF EXISTS "Entitlement_userId_fkey";
ALTER TABLE "Entitlement" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Entitlement"
  ADD CONSTRAINT "Entitlement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FamilyInvitation" DROP CONSTRAINT IF EXISTS "FamilyInvitation_invitedByUserId_fkey";
ALTER TABLE "FamilyInvitation" ALTER COLUMN "invitedByUserId" DROP NOT NULL;
ALTER TABLE "FamilyInvitation"
  ADD CONSTRAINT "FamilyInvitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SharedDish" DROP CONSTRAINT IF EXISTS "SharedDish_createdByUserId_fkey";
ALTER TABLE "SharedDish" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "SharedDish"
  ADD CONSTRAINT "SharedDish_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FamilyShoppingList" DROP CONSTRAINT IF EXISTS "FamilyShoppingList_regeneratedByUserId_fkey";
ALTER TABLE "FamilyShoppingList" ALTER COLUMN "regeneratedByUserId" DROP NOT NULL;
ALTER TABLE "FamilyShoppingList"
  ADD CONSTRAINT "FamilyShoppingList_regeneratedByUserId_fkey"
  FOREIGN KEY ("regeneratedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
