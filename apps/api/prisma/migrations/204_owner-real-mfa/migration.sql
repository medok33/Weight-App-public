ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "mfaVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recentOwnerReauthAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "OwnerMfaCredential" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'TOTP',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "encryptedSecret" JSONB NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OwnerMfaCredential_one_active_user"
  ON "OwnerMfaCredential" ("userId")
  WHERE status = 'ACTIVE' AND "disabledAt" IS NULL;
CREATE INDEX IF NOT EXISTS "OwnerMfaCredential_user_status_idx"
  ON "OwnerMfaCredential" ("userId", status);

CREATE TABLE IF NOT EXISTS "OwnerMfaEnrollmentDraft" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "encryptedSecret" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "OwnerMfaEnrollmentDraft_user_expiry_idx"
  ON "OwnerMfaEnrollmentDraft" ("userId", "expiresAt");

CREATE TABLE IF NOT EXISTS "OwnerMfaRecoveryCode" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "credentialId" UUID NOT NULL REFERENCES "OwnerMfaCredential"(id) ON DELETE CASCADE,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OwnerMfaRecoveryCode_credential_hash_key"
  ON "OwnerMfaRecoveryCode" ("credentialId", "codeHash");
CREATE INDEX IF NOT EXISTS "OwnerMfaRecoveryCode_user_used_idx"
  ON "OwnerMfaRecoveryCode" ("userId", "usedAt");

CREATE TABLE IF NOT EXISTS "MfaPreAuthChallenge" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "challengeHash" TEXT NOT NULL UNIQUE,
  "accountHash" TEXT NOT NULL,
  "sourceIpHash" TEXT NOT NULL,
  "accountIpHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "MfaPreAuthChallenge_user_expiry_idx"
  ON "MfaPreAuthChallenge" ("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "MfaPreAuthChallenge_hash_expiry_idx"
  ON "MfaPreAuthChallenge" ("challengeHash", "expiresAt");

CREATE TABLE IF NOT EXISTS "OwnerMfaReplayState" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "timeStep" BIGINT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OwnerMfaReplayState_user_step_key"
  ON "OwnerMfaReplayState" ("userId", "timeStep");
CREATE INDEX IF NOT EXISTS "OwnerMfaReplayState_accepted_idx"
  ON "OwnerMfaReplayState" ("acceptedAt");
