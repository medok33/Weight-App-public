-- STEP_158: deploy/rollback ledger for observability ops (sequence 156).
CREATE TABLE IF NOT EXISTS "DeployRun" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "migrationName" TEXT NOT NULL,
  "notes" TEXT,
  "actorUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "DeployRun_action_createdAt_idx" ON "DeployRun"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "DeployRun_migrationName_idx" ON "DeployRun"("migrationName");
