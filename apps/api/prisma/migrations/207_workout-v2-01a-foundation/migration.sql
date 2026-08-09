-- 207: WORKOUT-V2-01A foundation — extend Exercise / WorkoutPlan / WorkoutPlanDay + seed catalog

-- Exercise catalog extensions
ALTER TABLE "Exercise"
  ADD COLUMN IF NOT EXISTS "key" text,
  ADD COLUMN IF NOT EXISTS "nameRu" text,
  ADD COLUMN IF NOT EXISTS "nameEn" text,
  ADD COLUMN IF NOT EXISTS "movementPattern" text,
  ADD COLUMN IF NOT EXISTS "difficulty" text,
  ADD COLUMN IF NOT EXISTS "equipmentCodesJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "muscleGroupsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;

ALTER TABLE "Exercise" DROP CONSTRAINT IF EXISTS "Exercise_difficulty_check";
ALTER TABLE "Exercise"
  ADD CONSTRAINT "Exercise_difficulty_check"
  CHECK ("difficulty" IS NULL OR "difficulty" IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED'));

CREATE UNIQUE INDEX IF NOT EXISTS "Exercise_key_uidx"
  ON "Exercise" ("key")
  WHERE "key" IS NOT NULL;

-- WorkoutPlan metadata
ALTER TABLE "WorkoutPlan"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "algorithmVersion" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "inputSnapshotJson" jsonb,
  ADD COLUMN IF NOT EXISTS "generatedAt" timestamptz NOT NULL DEFAULT now();

-- WorkoutPlanDay richer rows
ALTER TABLE "WorkoutPlanDay"
  ADD COLUMN IF NOT EXISTS "exerciseOrder" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dayTitle" text,
  ADD COLUMN IF NOT EXISTS "isRestDay" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sets" integer,
  ADD COLUMN IF NOT EXISTS "repsMin" integer,
  ADD COLUMN IF NOT EXISTS "repsMax" integer,
  ADD COLUMN IF NOT EXISTS "restSeconds" integer,
  ADD COLUMN IF NOT EXISTS "exerciseId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkoutPlanDay_exerciseId_fkey'
  ) THEN
    ALTER TABLE "WorkoutPlanDay"
      ADD CONSTRAINT "WorkoutPlanDay_exerciseId_fkey"
      FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE "WorkoutPlanDay" DROP CONSTRAINT IF EXISTS "WorkoutPlanDay_workoutPlanId_dayIndex_key";
DROP INDEX IF EXISTS "WorkoutPlanDay_workoutPlanId_dayIndex_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkoutPlanDay_workoutPlanId_dayIndex_exerciseOrder_key'
  ) THEN
    ALTER TABLE "WorkoutPlanDay"
      ADD CONSTRAINT "WorkoutPlanDay_workoutPlanId_dayIndex_exerciseOrder_key"
      UNIQUE ("workoutPlanId", "dayIndex", "exerciseOrder");
  END IF;
END $$;

-- Idempotent seed (~14 active exercises). Stable keys include legacy DEFAULT_EXERCISES.
INSERT INTO "Exercise" (
  "id", "name", "riskLevel", "key", "nameRu", "nameEn",
  "movementPattern", "difficulty", "equipmentCodesJson", "muscleGroupsJson", "isActive"
) VALUES
  (gen_random_uuid(), 'morning_walk', 'low', 'morning_walk', 'Утренняя ходьба', 'Morning walk',
   'cardio', 'BEGINNER', '["NONE"]'::jsonb, '["cardio"]'::jsonb, true),
  (gen_random_uuid(), 'bodyweight_squats', 'low', 'bodyweight_squats', 'Приседания с весом тела', 'Bodyweight squats',
   'squat', 'BEGINNER', '["BODYWEIGHT"]'::jsonb, '["quads","glutes"]'::jsonb, true),
  (gen_random_uuid(), 'stretching', 'low', 'stretching', 'Растяжка', 'Stretching',
   'mobility', 'BEGINNER', '["NONE"]'::jsonb, '["mobility"]'::jsonb, true),
  (gen_random_uuid(), 'light_jog', 'medium', 'light_jog', 'Лёгкий бег', 'Light jog',
   'cardio', 'INTERMEDIATE', '["NONE"]'::jsonb, '["cardio"]'::jsonb, true),
  (gen_random_uuid(), 'core_plank', 'low', 'core_plank', 'Планка', 'Core plank',
   'core', 'BEGINNER', '["BODYWEIGHT"]'::jsonb, '["core"]'::jsonb, true),
  (gen_random_uuid(), 'mobility_flow', 'low', 'mobility_flow', 'Мобилити-поток', 'Mobility flow',
   'mobility', 'BEGINNER', '["NONE"]'::jsonb, '["mobility"]'::jsonb, true),
  (gen_random_uuid(), 'recovery_walk', 'low', 'recovery_walk', 'Восстановительная ходьба', 'Recovery walk',
   'cardio', 'BEGINNER', '["NONE"]'::jsonb, '["cardio"]'::jsonb, true),
  (gen_random_uuid(), 'push_ups', 'low', 'push_ups', 'Отжимания', 'Push-ups',
   'push', 'BEGINNER', '["BODYWEIGHT"]'::jsonb, '["chest","triceps"]'::jsonb, true),
  (gen_random_uuid(), 'glute_bridge', 'low', 'glute_bridge', 'Ягодичный мост', 'Glute bridge',
   'hinge', 'BEGINNER', '["BODYWEIGHT"]'::jsonb, '["glutes","hamstrings"]'::jsonb, true),
  (gen_random_uuid(), 'dead_bug', 'low', 'dead_bug', 'Dead bug', 'Dead bug',
   'core', 'BEGINNER', '["BODYWEIGHT"]'::jsonb, '["core"]'::jsonb, true),
  (gen_random_uuid(), 'band_row', 'low', 'band_row', 'Тяга резиной', 'Band row',
   'pull', 'BEGINNER', '["BAND"]'::jsonb, '["back","biceps"]'::jsonb, true),
  (gen_random_uuid(), 'band_pull_apart', 'low', 'band_pull_apart', 'Разведения резины', 'Band pull-apart',
   'pull', 'BEGINNER', '["BAND"]'::jsonb, '["upper_back","rear_delts"]'::jsonb, true),
  (gen_random_uuid(), 'dumbbell_row', 'medium', 'dumbbell_row', 'Тяга гантели', 'Dumbbell row',
   'pull', 'INTERMEDIATE', '["DUMBBELL"]'::jsonb, '["back","biceps"]'::jsonb, true),
  (gen_random_uuid(), 'goblet_squat', 'medium', 'goblet_squat', 'Гоблет-присед', 'Goblet squat',
   'squat', 'INTERMEDIATE', '["DUMBBELL"]'::jsonb, '["quads","glutes"]'::jsonb, true)
ON CONFLICT ("key") WHERE "key" IS NOT NULL DO UPDATE SET
  "name" = EXCLUDED."name",
  "riskLevel" = EXCLUDED."riskLevel",
  "nameRu" = EXCLUDED."nameRu",
  "nameEn" = EXCLUDED."nameEn",
  "movementPattern" = EXCLUDED."movementPattern",
  "difficulty" = EXCLUDED."difficulty",
  "equipmentCodesJson" = EXCLUDED."equipmentCodesJson",
  "muscleGroupsJson" = EXCLUDED."muscleGroupsJson",
  "isActive" = true;
