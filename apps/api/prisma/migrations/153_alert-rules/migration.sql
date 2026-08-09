-- STEP_154: alert rules and owner notifications (sequence 153)
CREATE TABLE IF NOT EXISTS "AlertRule" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "comparator" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "AlertRule_name_key" ON "AlertRule"("name");
CREATE INDEX IF NOT EXISTS "AlertRule_metric_idx" ON "AlertRule"("metric");

CREATE TABLE IF NOT EXISTS "OwnerNotification" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ruleId" UUID NOT NULL,
  "message" TEXT NOT NULL,
  "delivered" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerNotification_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "OwnerNotification_createdAt_idx" ON "OwnerNotification"("createdAt");
CREATE INDEX IF NOT EXISTS "OwnerNotification_ruleId_idx" ON "OwnerNotification"("ruleId");
