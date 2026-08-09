-- AUTH-01A additive identity ownership, invites and recovery tokens.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailOwnershipProvenAt" timestamptz;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailOwnershipProofType" text;
CREATE TABLE IF NOT EXISTS "BetaInvite" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "emailNormalized" text NOT NULL,
  "tokenHash" text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "redeemedAt" timestamptz, "revokedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" uuid NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "replacedByInviteId" uuid REFERENCES "BetaInvite"(id) ON DELETE SET NULL,
  "deliveryProvenAt" timestamptz, "deliveryProofType" text
);
CREATE INDEX IF NOT EXISTS "BetaInvite_emailNormalized_idx" ON "BetaInvite" ("emailNormalized");
CREATE INDEX IF NOT EXISTS "BetaInvite_expiresAt_idx" ON "BetaInvite" ("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "BetaInvite_one_active_email_idx" ON "BetaInvite" ("emailNormalized") WHERE "redeemedAt" IS NULL AND "revokedAt" IS NULL;
CREATE TABLE IF NOT EXISTS "PasswordRecoveryToken" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "tokenHash" text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "redeemedAt" timestamptz, "replacedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryProvenAt" timestamptz, "deliveryProofType" text
);
CREATE INDEX IF NOT EXISTS "PasswordRecoveryToken_userId_idx" ON "PasswordRecoveryToken" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordRecoveryToken_one_active_user_idx" ON "PasswordRecoveryToken" ("userId") WHERE "redeemedAt" IS NULL AND "replacedAt" IS NULL;
