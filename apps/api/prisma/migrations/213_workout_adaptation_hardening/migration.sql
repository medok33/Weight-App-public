-- 213: WORKOUT-V2-01D-FIX1 corrective hardening
-- Additive. Does not amend 210/211/212. Safe to re-run (IF NOT EXISTS / OR REPLACE).

-- ---------------------------------------------------------------------------
-- Harden WorkoutAdaptation immutability trigger (include workoutPlanId;
-- only status + undoneAt may change on APPLIED → UNDONE)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workout_adaptation_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WORKOUT_ADAPTATION_IMMUTABLE';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'UNDONE' THEN
      RAISE EXCEPTION 'WORKOUT_ADAPTATION_IMMUTABLE';
    END IF;

    -- Only APPLIED → UNDONE with status/undoneAt changes is allowed.
    IF NEW.status = 'UNDONE'
       AND OLD.status = 'APPLIED'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
       AND NEW."workoutPlanId" IS NOT DISTINCT FROM OLD."workoutPlanId"
       AND NEW."workoutSessionId" IS NOT DISTINCT FROM OLD."workoutSessionId"
       AND NEW.intent IS NOT DISTINCT FROM OLD.intent
       AND NEW."selectedOptionCode" IS NOT DISTINCT FROM OLD."selectedOptionCode"
       AND NEW."policyVersion" IS NOT DISTINCT FROM OLD."policyVersion"
       AND NEW."catalogReleaseId" IS NOT DISTINCT FROM OLD."catalogReleaseId"
       AND NEW."sessionVersionBefore" IS NOT DISTINCT FROM OLD."sessionVersionBefore"
       AND NEW."sessionVersionAfter" IS NOT DISTINCT FROM OLD."sessionVersionAfter"
       AND NEW."beforeSnapshot" IS NOT DISTINCT FROM OLD."beforeSnapshot"
       AND NEW."afterSnapshot" IS NOT DISTINCT FROM OLD."afterSnapshot"
       AND NEW."goalImpactSnapshot" IS NOT DISTINCT FROM OLD."goalImpactSnapshot"
       AND NEW."idempotencyKey" IS NOT DISTINCT FROM OLD."idempotencyKey"
       AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
       AND OLD."undoneAt" IS NULL
    THEN
      NEW."undoneAt" := COALESCE(NEW."undoneAt", now());
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'WORKOUT_ADAPTATION_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workout_adaptation_immutable_trg ON "WorkoutAdaptation";
CREATE TRIGGER workout_adaptation_immutable_trg
  BEFORE UPDATE OR DELETE ON "WorkoutAdaptation"
  FOR EACH ROW
  EXECUTE FUNCTION workout_adaptation_immutable_guard();

-- Legacy unique index was under-scoped (userId + key only). Commands replace it.
DROP INDEX IF EXISTS "WorkoutAdaptation_user_idempotency_uidx";

-- ---------------------------------------------------------------------------
-- Immutable idempotent command ledger (APPLY / UNDO), scoped to session
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WorkoutAdaptationCommand" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "workoutSessionId" uuid NOT NULL REFERENCES "WorkoutSession"(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('APPLY', 'UNDO')),
  "idempotencyKey" text NOT NULL,
  "requestHash" text NOT NULL,
  "adaptationId" uuid REFERENCES "WorkoutAdaptation"(id) ON DELETE SET NULL,
  "responseSnapshot" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutAdaptationCommand_scope_uidx"
  ON "WorkoutAdaptationCommand"("userId", "workoutSessionId", action, "idempotencyKey");

CREATE INDEX IF NOT EXISTS "WorkoutAdaptationCommand_session_created_idx"
  ON "WorkoutAdaptationCommand"("workoutSessionId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION workout_adaptation_command_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WORKOUT_ADAPTATION_COMMAND_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS workout_adaptation_command_immutable_trg ON "WorkoutAdaptationCommand";
CREATE TRIGGER workout_adaptation_command_immutable_trg
  BEFORE UPDATE OR DELETE ON "WorkoutAdaptationCommand"
  FOR EACH ROW
  EXECUTE FUNCTION workout_adaptation_command_immutable_guard();

-- ---------------------------------------------------------------------------
-- Optional plan timezone snapshot (IANA). Authoritative SoT remains UserProfile.timezone;
-- plan column stores the value used when the plan was generated / last synced.
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkoutPlan"
  ADD COLUMN IF NOT EXISTS "timeZone" text;

COMMENT ON COLUMN "WorkoutPlan"."timeZone" IS
  'IANA timezone snapshot for calendar-day semantics. SoT: UserProfile.timezone; NULL → UTC fallback.';
