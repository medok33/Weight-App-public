-- STEP_157: restore test results (sequence 155). Results live on the primary DB;
-- restore target is always a disposable database, never the primary.
CREATE TABLE IF NOT EXISTS "RestoreTestResult" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sourceBackupJobId" UUID NOT NULL,
  "targetEnvironment" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "checks" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "errorCode" TEXT,
  "targetDatabase" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestoreTestResult_sourceBackupJobId_fkey"
    FOREIGN KEY ("sourceBackupJobId") REFERENCES "BackupJob"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "RestoreTestResult_status_createdAt_idx"
  ON "RestoreTestResult"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "RestoreTestResult_sourceBackupJobId_idx"
  ON "RestoreTestResult"("sourceBackupJobId");
