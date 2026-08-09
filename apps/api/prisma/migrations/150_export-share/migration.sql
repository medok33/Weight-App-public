-- STEP_141: ExportJob model and state machine foundation
CREATE TABLE IF NOT EXISTS "ExportJob" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExportJob_idempotencyKey_key" ON "ExportJob"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ExportJob_userId_createdAt_idx" ON "ExportJob"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ExportJob_status_createdAt_idx" ON "ExportJob"("status", "createdAt");
