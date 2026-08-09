CREATE TABLE IF NOT EXISTS "PlanRevision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "planId" uuid NOT NULL,
  "planKind" text NOT NULL CHECK ("planKind" IN ('meal', 'workout')),
  version integer NOT NULL CHECK (version > 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed')),
  snapshot jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanRevision_planId_planKind_version_key"
  ON "PlanRevision" ("planId", "planKind", version);

CREATE INDEX IF NOT EXISTS "PlanRevision_userId_createdAt_idx"
  ON "PlanRevision" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "PlanRevision_planId_planKind_idx"
  ON "PlanRevision" ("planId", "planKind");

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
