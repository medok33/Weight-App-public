-- STEP_155: encrypted backup job ledger (sequence 154)
CREATE TABLE IF NOT EXISTS "BackupJob" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "storageKey" TEXT,
  "byteLength" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "BackupJob_idempotencyKey_key" ON "BackupJob"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "BackupJob_status_createdAt_idx" ON "BackupJob"("status", "createdAt");
