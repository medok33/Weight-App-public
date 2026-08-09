-- STEP_137: refund request / admin decision columns on Refund
ALTER TABLE "Refund"
  ADD COLUMN IF NOT EXISTS "requestedByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "decidedByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decisionNote" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key"
  ON "Refund"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Refund_status_createdAt_idx"
  ON "Refund"("status", "createdAt");
