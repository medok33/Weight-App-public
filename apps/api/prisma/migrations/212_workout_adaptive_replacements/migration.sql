-- 212: WORKOUT-V2-01D adaptive replacements & goal impact
-- Additive. Does not amend 210/211. Safe to re-run (IF NOT EXISTS / OR REPLACE guards).

-- ---------------------------------------------------------------------------
-- Session optimistic concurrency + revision provenance on exercise snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkoutSession"
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "exerciseRevisionId" uuid,
  ADD COLUMN IF NOT EXISTS "catalogReleaseId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkoutSessionExercise_exerciseRevisionId_fkey'
  ) THEN
    ALTER TABLE "WorkoutSessionExercise"
      ADD CONSTRAINT "WorkoutSessionExercise_exerciseRevisionId_fkey"
      FOREIGN KEY ("exerciseRevisionId") REFERENCES "ExerciseRevision"(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkoutSessionExercise_catalogReleaseId_fkey'
  ) THEN
    ALTER TABLE "WorkoutSessionExercise"
      ADD CONSTRAINT "WorkoutSessionExercise_catalogReleaseId_fkey"
      FOREIGN KEY ("catalogReleaseId") REFERENCES "WorkoutCatalogRelease"(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "WorkoutSessionExercise_revision_idx"
  ON "WorkoutSessionExercise"("exerciseRevisionId");
CREATE INDEX IF NOT EXISTS "WorkoutSessionExercise_release_idx"
  ON "WorkoutSessionExercise"("catalogReleaseId");

-- ---------------------------------------------------------------------------
-- Immutable adaptation audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WorkoutAdaptation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "workoutPlanId" uuid REFERENCES "WorkoutPlan"(id) ON DELETE SET NULL,
  "workoutSessionId" uuid NOT NULL REFERENCES "WorkoutSession"(id) ON DELETE CASCADE,
  intent text NOT NULL
    CHECK (intent IN ('HOME', 'SHORTER', 'LIGHTER', 'WALK_RECOVERY', 'MOVE_DAY')),
  "selectedOptionCode" text NOT NULL,
  "policyVersion" text NOT NULL,
  "catalogReleaseId" uuid REFERENCES "WorkoutCatalogRelease"(id) ON DELETE SET NULL,
  "sessionVersionBefore" integer NOT NULL,
  "sessionVersionAfter" integer NOT NULL,
  "beforeSnapshot" jsonb NOT NULL,
  "afterSnapshot" jsonb NOT NULL,
  "goalImpactSnapshot" jsonb NOT NULL,
  status text NOT NULL DEFAULT 'APPLIED'
    CHECK (status IN ('APPLIED', 'UNDONE')),
  "idempotencyKey" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "undoneAt" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutAdaptation_user_idempotency_uidx"
  ON "WorkoutAdaptation"("userId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "WorkoutAdaptation_session_created_idx"
  ON "WorkoutAdaptation"("workoutSessionId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "WorkoutAdaptation_user_created_idx"
  ON "WorkoutAdaptation"("userId", "createdAt" DESC);

-- Applied adaptations are immutable except status/undoneAt transitions.
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
    IF NEW.status = 'UNDONE'
       AND OLD.status = 'APPLIED'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
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
