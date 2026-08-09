-- STEP_100: confirmation-only status + durable confirm idempotency
-- Does not alter migration 167 body; upgrades existing DBs safely.

DROP TRIGGER IF EXISTS "PlanRevision_deny_update" ON "PlanRevision";
DROP TRIGGER IF EXISTS "PlanRevision_deny_delete" ON "PlanRevision";

-- No pending rows should exist under confirmation-only model; clear if any leaked.
DELETE FROM "PlanRevision" WHERE status <> 'confirmed';

ALTER TABLE "PlanRevision" DROP CONSTRAINT IF EXISTS "PlanRevision_status_check";
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_status_check" CHECK (status = 'confirmed');

ALTER TABLE "PlanRevision" ADD COLUMN IF NOT EXISTS "idempotencyKey" text;
ALTER TABLE "PlanRevision" ADD COLUMN IF NOT EXISTS "requestHash" text;

CREATE UNIQUE INDEX IF NOT EXISTS "PlanRevision_userId_idempotencyKey_key"
  ON "PlanRevision" ("userId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE OR REPLACE FUNCTION "PlanRevision_deny_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PLAN_REVISION_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS "PlanRevision_deny_update" ON "PlanRevision";
CREATE TRIGGER "PlanRevision_deny_update"
  BEFORE UPDATE ON "PlanRevision"
  FOR EACH ROW
  EXECUTE FUNCTION "PlanRevision_deny_mutation"();

DROP TRIGGER IF EXISTS "PlanRevision_deny_delete" ON "PlanRevision";
CREATE TRIGGER "PlanRevision_deny_delete"
  BEFORE DELETE ON "PlanRevision"
  FOR EACH ROW
  EXECUTE FUNCTION "PlanRevision_deny_mutation"();
