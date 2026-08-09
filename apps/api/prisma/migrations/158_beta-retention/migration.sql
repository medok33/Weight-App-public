-- STEP_167: beta onboarding progress + feedback (sequence 158).
CREATE TABLE IF NOT EXISTS "BetaOnboardingProgress" (
  "userId" UUID NOT NULL,
  "stepKey" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "stepKey")
);

CREATE INDEX IF NOT EXISTS "BetaOnboardingProgress_userId_idx"
  ON "BetaOnboardingProgress"("userId");

CREATE TABLE IF NOT EXISTS "BetaFeedback" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BetaFeedback_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX IF NOT EXISTS "BetaFeedback_userId_createdAt_idx"
  ON "BetaFeedback"("userId", "createdAt");
