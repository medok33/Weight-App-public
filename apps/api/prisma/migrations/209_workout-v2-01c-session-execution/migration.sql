-- 209: WORKOUT-V2-01C workout session execution.
-- Custom SQL migration: additive, non-destructive and safe to re-run.

CREATE TABLE IF NOT EXISTS "WorkoutSession" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "workoutPlanId" uuid REFERENCES "WorkoutPlan"(id) ON DELETE SET NULL,
  "sourceDayIndex" integer NOT NULL CHECK ("sourceDayIndex" BETWEEN 0 AND 6),
  "effectiveDayIndex" integer NOT NULL CHECK ("effectiveDayIndex" BETWEEN 0 AND 6),
  "effectiveDate" date NOT NULL,
  "dayTitle" text,
  "estimatedMinutes" integer,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED')),
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "lastActivityAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz,
  "abandonedAt" timestamptz,
  "durationSeconds" integer,
  "totalExercises" integer NOT NULL DEFAULT 0,
  "completedExercises" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "WorkoutSession_userId_idx"
  ON "WorkoutSession"("userId");
CREATE INDEX IF NOT EXISTS "WorkoutSession_userId_status_idx"
  ON "WorkoutSession"("userId", status);
CREATE INDEX IF NOT EXISTS "WorkoutSession_workoutPlanId_idx"
  ON "WorkoutSession"("workoutPlanId");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutSession_active_user_uidx"
  ON "WorkoutSession"("userId") WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS "WorkoutSessionExercise" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "WorkoutSession"(id) ON DELETE CASCADE,
  "sourceExerciseId" uuid REFERENCES "Exercise"(id) ON DELETE SET NULL,
  "sourcePlanDayRowId" uuid REFERENCES "WorkoutPlanDay"(id) ON DELETE SET NULL,
  "exerciseKey" text,
  "orderIndex" integer NOT NULL,
  "displayNameRu" text NOT NULL,
  "displayNameEn" text NOT NULL,
  "targetSets" integer NOT NULL DEFAULT 1 CHECK ("targetSets" >= 1 AND "targetSets" <= 20),
  "targetRepsMin" integer,
  "targetRepsMax" integer,
  "targetDurationSeconds" integer,
  "restSeconds" integer,
  "techniqueSummaryRu" text,
  "techniqueSummaryEn" text,
  "commonMistakeRu" text,
  "commonMistakeEn" text,
  "easierVariantRu" text,
  "easierVariantEn" text,
  "mediaSnapshotJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  "skippedAt" timestamptz,
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutSessionExercise_session_order_uidx" UNIQUE ("sessionId", "orderIndex")
);

CREATE INDEX IF NOT EXISTS "WorkoutSessionExercise_sessionId_idx"
  ON "WorkoutSessionExercise"("sessionId");

CREATE TABLE IF NOT EXISTS "WorkoutSessionSet" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionExerciseId" uuid NOT NULL REFERENCES "WorkoutSessionExercise"(id) ON DELETE CASCADE,
  "setIndex" integer NOT NULL CHECK ("setIndex" >= 1 AND "setIndex" <= 20),
  "targetReps" integer,
  "targetDurationSeconds" integer,
  "actualReps" integer,
  "actualDurationSeconds" integer,
  "weightKg" numeric(8,2),
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutSessionSet_exercise_set_uidx" UNIQUE ("sessionExerciseId", "setIndex")
);

CREATE INDEX IF NOT EXISTS "WorkoutSessionSet_sessionExerciseId_idx"
  ON "WorkoutSessionSet"("sessionExerciseId");
