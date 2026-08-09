CREATE TABLE "OwnerMfaChallenge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerMfaChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerMfaChallenge_nonceHash_key" ON "OwnerMfaChallenge"("nonceHash");
CREATE INDEX "OwnerMfaChallenge_userId_expiresAt_idx" ON "OwnerMfaChallenge"("userId", "expiresAt");
ALTER TABLE "OwnerMfaChallenge" ADD CONSTRAINT "OwnerMfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

CREATE TABLE "OwnerAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerAuditEvent_userId_createdAt_idx" ON "OwnerAuditEvent"("userId", "createdAt");
ALTER TABLE "OwnerAuditEvent" ADD CONSTRAINT "OwnerAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
