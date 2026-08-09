-- 218: WORKOUT-ENERGY-01B canonical plan prescription + session energy snapshot
-- Additive. Does not amend 1-217. Safe to re-run (IF NOT EXISTS / guarded ADD COLUMN).
-- Does NOT rewrite historical WorkoutPlanDay / WorkoutSession / WorkoutSessionExercise
-- energy values (no fake backfill, no AVAILABLE default).
-- ExerciseRevision.repetitionMode restoration uses explicit canonical catalog values
-- (canonical-content-01b.json), only where the new column is still NULL.
-- FIX-01: ACCESS EXCLUSIVE lock + repetitionMode in immutable guard before backfill;
--         DURATION plan rows require sets=1; no timing pilot seed rows.
-- Not applied to shared/staging/production in this package.

-- ---------------------------------------------------------------------------
-- A. ExerciseRevision.repetitionMode (catalog metadata restoration)
-- ---------------------------------------------------------------------------
ALTER TABLE "ExerciseRevision"
  ADD COLUMN IF NOT EXISTS "repetitionMode" text
  CONSTRAINT "ExerciseRevision_repetitionMode_chk"
    CHECK (
      "repetitionMode" IS NULL
      OR "repetitionMode" IN ('REPS', 'DURATION', 'REPS_OR_DURATION')
    );

-- Hold exclusive access for the one-time restoration window, then harden the
-- content-unchanged guard BEFORE any trigger suspension so APPROVED→RETIRE
-- cannot smuggle a repetitionMode change after this migration commits.
LOCK TABLE "ExerciseRevision" IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION workout_catalog_revision_content_unchanged(OLD "ExerciseRevision", NEW "ExerciseRevision")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    NEW."nameRu" IS NOT DISTINCT FROM OLD."nameRu"
    AND NEW."nameEn" IS NOT DISTINCT FROM OLD."nameEn"
    AND NEW."techniqueRu" IS NOT DISTINCT FROM OLD."techniqueRu"
    AND NEW."techniqueEn" IS NOT DISTINCT FROM OLD."techniqueEn"
    AND NEW."commonMistakeRu" IS NOT DISTINCT FROM OLD."commonMistakeRu"
    AND NEW."commonMistakeEn" IS NOT DISTINCT FROM OLD."commonMistakeEn"
    AND NEW."easierVariantRu" IS NOT DISTINCT FROM OLD."easierVariantRu"
    AND NEW."easierVariantEn" IS NOT DISTINCT FROM OLD."easierVariantEn"
    AND NEW."harderVariantRu" IS NOT DISTINCT FROM OLD."harderVariantRu"
    AND NEW."harderVariantEn" IS NOT DISTINCT FROM OLD."harderVariantEn"
    AND NEW."breathingRu" IS NOT DISTINCT FROM OLD."breathingRu"
    AND NEW."breathingEn" IS NOT DISTINCT FROM OLD."breathingEn"
    AND NEW."stopConditionsRu" IS NOT DISTINCT FROM OLD."stopConditionsRu"
    AND NEW."stopConditionsEn" IS NOT DISTINCT FROM OLD."stopConditionsEn"
    AND NEW."defaultSets" IS NOT DISTINCT FROM OLD."defaultSets"
    AND NEW."defaultRepsMin" IS NOT DISTINCT FROM OLD."defaultRepsMin"
    AND NEW."defaultRepsMax" IS NOT DISTINCT FROM OLD."defaultRepsMax"
    AND NEW."defaultDurationSeconds" IS NOT DISTINCT FROM OLD."defaultDurationSeconds"
    AND NEW."defaultRestSeconds" IS NOT DISTINCT FROM OLD."defaultRestSeconds"
    AND NEW."estimatedDurationSeconds" IS NOT DISTINCT FROM OLD."estimatedDurationSeconds"
    AND NEW."repetitionMode" IS NOT DISTINCT FROM OLD."repetitionMode"
    AND NEW."exerciseId" IS NOT DISTINCT FROM OLD."exerciseId"
    AND NEW."revisionNumber" IS NOT DISTINCT FROM OLD."revisionNumber"
    AND NEW."createdBy" IS NOT DISTINCT FROM OLD."createdBy"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
    AND NEW."reviewedAt" IS NOT DISTINCT FROM OLD."reviewedAt"
    AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt";
$$;

-- Approved revisions are normally immutable. Temporarily suspend only the
-- revision UPDATE trigger for this explicit one-time canonical restoration
-- under the ACCESS EXCLUSIVE lock; re-enable before other schema work.
ALTER TABLE "ExerciseRevision"
  DISABLE TRIGGER "ExerciseRevision_immutable_upd";

UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'morning_walk' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'bodyweight_squats' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'stretching' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'light_jog' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'core_plank' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'mobility_flow' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'recovery_walk' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'push_ups' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'glute_bridge' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dead_bug' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_pull_apart' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'goblet_squat' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'machine_leg_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'cable_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'treadmill_walk' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'chest_press_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'barbell_romanian_deadlift' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'lat_pulldown' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'chair_sit_to_stand' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'wall_sit' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'box_squat_to_chair' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_romanian_deadlift' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'bodyweight_hip_thrust' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'barbell_hip_thrust' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'good_morning_bodyweight' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'supported_reverse_lunge' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'reverse_lunge' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'static_split_squat' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'low_step_up' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_step_up' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'knee_push_ups' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'incline_push_ups' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_floor_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'barbell_bench_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_shoulder_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'seated_machine_shoulder_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_overhead_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_face_pull' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'seated_cable_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'chest_supported_dumbbell_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'barbell_bent_over_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'assisted_pull_up_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_lat_pulldown' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'forearm_plank_knees' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'bird_dog' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'side_plank_knee' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'side_plank' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'pallof_press_band' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'heel_taps' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dead_bug_hold' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'side_lying_clamshell' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_lateral_walk' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'glute_bridge_march' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'standing_calf_raise' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'seated_calf_raise_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'farmer_carry_dumbbell' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'suitcase_carry_dumbbell' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'brisk_outdoor_walk' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'stationary_bike_easy' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'elliptical_easy' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'seated_march' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'cat_cow_flow' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'hip_flexor_stretch' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'thoracic_opener_open_book' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'diaphragmatic_breathing' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'supine_knee_hugs' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'seated_leg_curl_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'leg_extension_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'cable_chest_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'pec_deck_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'lat_pulldown_neutral_grip' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_squat' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_glute_bridge' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'band_chest_press' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_goblet_split_squat' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'dumbbell_lateral_raise' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'machine_hip_abduction' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'back_extension_machine' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'standing_band_row' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'mat_glute_bridge_hold' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'REPS_OR_DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'wall_angels' AND r."repetitionMode" IS NULL;
UPDATE "ExerciseRevision" r SET "repetitionMode" = 'DURATION' FROM "Exercise" e WHERE e.id = r."exerciseId" AND e.key = 'ankle_rocks' AND r."repetitionMode" IS NULL;

ALTER TABLE "ExerciseRevision"
  ENABLE TRIGGER "ExerciseRevision_immutable_upd";

-- Post-backfill verification: every canonical catalog key must have a mode.
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM "Exercise" e
  JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
  WHERE r."repetitionMode" IS NULL
    AND e.key IN (
      'morning_walk','bodyweight_squats','stretching','light_jog','core_plank','mobility_flow',
      'recovery_walk','push_ups','glute_bridge','dead_bug','band_row','band_pull_apart',
      'dumbbell_row','goblet_squat','machine_leg_press','cable_row','treadmill_walk',
      'chest_press_machine','barbell_romanian_deadlift','lat_pulldown','chair_sit_to_stand',
      'wall_sit','box_squat_to_chair','dumbbell_romanian_deadlift','bodyweight_hip_thrust',
      'barbell_hip_thrust','good_morning_bodyweight','supported_reverse_lunge','reverse_lunge',
      'static_split_squat','low_step_up','dumbbell_step_up','knee_push_ups','incline_push_ups',
      'dumbbell_floor_press','barbell_bench_press','dumbbell_shoulder_press',
      'seated_machine_shoulder_press','band_overhead_press','band_face_pull','seated_cable_row',
      'chest_supported_dumbbell_row','barbell_bent_over_row','assisted_pull_up_machine',
      'band_lat_pulldown','forearm_plank_knees','bird_dog','side_plank_knee','side_plank',
      'pallof_press_band','heel_taps','dead_bug_hold','side_lying_clamshell','band_lateral_walk',
      'glute_bridge_march','standing_calf_raise','seated_calf_raise_machine','farmer_carry_dumbbell',
      'suitcase_carry_dumbbell','brisk_outdoor_walk','stationary_bike_easy','elliptical_easy',
      'seated_march','cat_cow_flow','hip_flexor_stretch','thoracic_opener_open_book',
      'diaphragmatic_breathing','supine_knee_hugs','seated_leg_curl_machine','leg_extension_machine',
      'cable_chest_press','pec_deck_machine','lat_pulldown_neutral_grip','band_squat',
      'band_glute_bridge','band_chest_press','dumbbell_goblet_split_squat','dumbbell_lateral_raise',
      'machine_hip_abduction','back_extension_machine','standing_band_row','mat_glute_bridge_hold',
      'wall_angels','ankle_rocks'
    );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'WORKOUT_ENERGY_01B_REPETITION_MODE_BACKFILL_INCOMPLETE:%', missing_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B. WorkoutPlanDay canonical prescription (nullable for historical rows)
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkoutPlanDay"
  ADD COLUMN IF NOT EXISTS "prescriptionMode" text
  CONSTRAINT "WorkoutPlanDay_prescriptionMode_chk"
    CHECK (
      "prescriptionMode" IS NULL
      OR "prescriptionMode" IN ('REPS', 'DURATION')
    );

ALTER TABLE "WorkoutPlanDay"
  ADD COLUMN IF NOT EXISTS "durationSecondsPerSet" integer
  CONSTRAINT "WorkoutPlanDay_durationSecondsPerSet_chk"
    CHECK (
      "durationSecondsPerSet" IS NULL
      OR ("durationSecondsPerSet" > 0 AND "durationSecondsPerSet" <= 10800)
    );

-- New DURATION plans must use sets=1 (whole-exercise interval). Historical
-- nullable prescriptionMode rows remain compatible without rewrite.
ALTER TABLE "WorkoutPlanDay"
  DROP CONSTRAINT IF EXISTS "WorkoutPlanDay_duration_sets_coherence_chk";
ALTER TABLE "WorkoutPlanDay"
  ADD CONSTRAINT "WorkoutPlanDay_duration_sets_coherence_chk"
  CHECK (
    "prescriptionMode" IS DISTINCT FROM 'DURATION'
    OR (
      "sets" = 1
      AND "durationSecondsPerSet" IS NOT NULL
      AND "repsMin" IS NULL
      AND "repsMax" IS NULL
    )
  );

-- Historical rows remain nullable without energy/plan backfill.

-- ---------------------------------------------------------------------------
-- C. ExerciseEnergyTimingProfile (internal seconds-per-rep; NOT Compendium)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseEnergyTimingProfile" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseRevisionId" uuid NOT NULL
    REFERENCES "ExerciseRevision"(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  "timingMethod" text NOT NULL
    CHECK ("timingMethod" IN ('SECONDS_PER_REP')),
  "secondsPerRep" numeric(8,4) NOT NULL
    CHECK ("secondsPerRep" > 0 AND "secondsPerRep" <= 60),
  "sourceType" text NOT NULL
    CHECK ("sourceType" IN ('INTERNAL_REVIEWED_POLICY')),
  "sourceReference" text NOT NULL
    CHECK (char_length(trim("sourceReference")) > 0),
  "sourceVersion" text NOT NULL
    CHECK (char_length(trim("sourceVersion")) > 0),
  "policyVersion" text NOT NULL
    CHECK (char_length(trim("policyVersion")) > 0),
  "enabledForCalculation" boolean NOT NULL DEFAULT false,
  "reviewedAt" timestamptz,
  "reviewedBy" text,
  "approvedAt" timestamptz,
  "retiredAt" timestamptz,
  "retirementReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseEnergyTimingProfile_approved_review_chk" CHECK (
    status <> 'APPROVED'
    OR (
      "reviewedAt" IS NOT NULL
      AND "reviewedBy" IS NOT NULL
      AND char_length(trim("reviewedBy")) > 0
      AND "approvedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "ExerciseEnergyTimingProfile_enabled_approved_chk" CHECK (
    "enabledForCalculation" = false OR status = 'APPROVED'
  ),
  CONSTRAINT "ExerciseEnergyTimingProfile_retired_at_chk" CHECK (
    status <> 'RETIRED' OR "retiredAt" IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExerciseEnergyTimingProfile_revision_policy_active_uidx"
  ON "ExerciseEnergyTimingProfile" ("exerciseRevisionId", "policyVersion")
  WHERE status IN ('DRAFT', 'APPROVED');

CREATE INDEX IF NOT EXISTS "ExerciseEnergyTimingProfile_revision_idx"
  ON "ExerciseEnergyTimingProfile" ("exerciseRevisionId");

CREATE INDEX IF NOT EXISTS "ExerciseEnergyTimingProfile_status_idx"
  ON "ExerciseEnergyTimingProfile" (status);

CREATE INDEX IF NOT EXISTS "ExerciseEnergyTimingProfile_runtime_idx"
  ON "ExerciseEnergyTimingProfile" ("exerciseRevisionId", "policyVersion")
  WHERE status = 'APPROVED' AND "enabledForCalculation" = true;

-- ---------------------------------------------------------------------------
-- D. WorkoutSessionExercise planned energy snapshot (nullable = legacy / unset)
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyEstimateStatus" text
  CONSTRAINT "WorkoutSessionExercise_energyEstimateStatus_chk"
    CHECK (
      "energyEstimateStatus" IS NULL
      OR "energyEstimateStatus" IN (
        'AVAILABLE',
        'UNAVAILABLE_MISSING_WEIGHT',
        'UNAVAILABLE_MISSING_ENERGY_PROFILE',
        'UNAVAILABLE_UNSUPPORTED_POPULATION',
        'UNAVAILABLE_MISSING_ACTIVE_DURATION',
        'INVALID_ENERGY_PROFILE',
        'INVALID_CALCULATION_INPUT',
        'UNSUPPORTED_CALCULATION_METHOD',
        'INVALID_PLAN_PRESCRIPTION',
        'AMBIGUOUS_TIMING_PROFILE'
      )
    );

ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "plannedGrossEstimatedKcal" numeric(12,4);
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "plannedRestingEstimatedKcal" numeric(12,4);
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "plannedIncrementalEstimatedKcal" numeric(12,4);
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyWeightKgUsed" numeric(8,3);
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyWeightSource" text
  CONSTRAINT "WorkoutSessionExercise_energyWeightSource_chk"
    CHECK (
      "energyWeightSource" IS NULL
      OR "energyWeightSource" IN ('PROGRESS_MEASUREMENT', 'PROFILE_FALLBACK')
    );
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyWeightSourceRecordedAt" timestamptz;
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyActiveSecondsUsed" numeric(12,4);
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "exerciseEnergyProfileId" uuid
    REFERENCES "ExerciseEnergyProfile"(id) ON DELETE RESTRICT;
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "exerciseEnergyTimingProfileId" uuid
    REFERENCES "ExerciseEnergyTimingProfile"(id) ON DELETE RESTRICT;
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyCalculationMethod" text
  CONSTRAINT "WorkoutSessionExercise_energyCalculationMethod_chk"
    CHECK (
      "energyCalculationMethod" IS NULL
      OR "energyCalculationMethod" IN ('MET_DURATION')
    );
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyPopulationType" text
  CONSTRAINT "WorkoutSessionExercise_energyPopulationType_chk"
    CHECK (
      "energyPopulationType" IS NULL
      OR "energyPopulationType" IN ('ADULT_STANDARD_2024')
    );
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyPolicyVersion" text;
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energySourceVersion" text;
ALTER TABLE "WorkoutSessionExercise"
  ADD COLUMN IF NOT EXISTS "energyCalculatedAt" timestamptz;

-- AVAILABLE completeness + numeric coherence (when status present)
ALTER TABLE "WorkoutSessionExercise"
  DROP CONSTRAINT IF EXISTS "WorkoutSessionExercise_energy_available_chk";
ALTER TABLE "WorkoutSessionExercise"
  ADD CONSTRAINT "WorkoutSessionExercise_energy_available_chk" CHECK (
    "energyEstimateStatus" IS DISTINCT FROM 'AVAILABLE'
    OR (
      "plannedGrossEstimatedKcal" IS NOT NULL
      AND "plannedRestingEstimatedKcal" IS NOT NULL
      AND "plannedIncrementalEstimatedKcal" IS NOT NULL
      AND "energyWeightKgUsed" IS NOT NULL
      AND "energyActiveSecondsUsed" IS NOT NULL
      AND "exerciseEnergyProfileId" IS NOT NULL
      AND "energyCalculationMethod" IS NOT NULL
      AND "energyPopulationType" IS NOT NULL
      AND "energyPolicyVersion" IS NOT NULL
      AND char_length(trim("energyPolicyVersion")) > 0
      AND "energySourceVersion" IS NOT NULL
      AND char_length(trim("energySourceVersion")) > 0
      AND "energyCalculatedAt" IS NOT NULL
      AND "plannedGrossEstimatedKcal" >= 0
      AND "plannedRestingEstimatedKcal" >= 0
      AND "plannedIncrementalEstimatedKcal" >= 0
      AND "plannedGrossEstimatedKcal" >= "plannedRestingEstimatedKcal"
      AND "energyActiveSecondsUsed" > 0
      AND "energyWeightKgUsed" > 0
    )
  );

-- Unavailable / invalid: successful kcal fields must be null
ALTER TABLE "WorkoutSessionExercise"
  DROP CONSTRAINT IF EXISTS "WorkoutSessionExercise_energy_unavailable_null_chk";
ALTER TABLE "WorkoutSessionExercise"
  ADD CONSTRAINT "WorkoutSessionExercise_energy_unavailable_null_chk" CHECK (
    "energyEstimateStatus" IS NULL
    OR "energyEstimateStatus" = 'AVAILABLE'
    OR (
      "plannedGrossEstimatedKcal" IS NULL
      AND "plannedRestingEstimatedKcal" IS NULL
      AND "plannedIncrementalEstimatedKcal" IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS "WorkoutSessionExercise_energy_profile_idx"
  ON "WorkoutSessionExercise" ("exerciseEnergyProfileId");

CREATE INDEX IF NOT EXISTS "WorkoutSessionExercise_energy_timing_idx"
  ON "WorkoutSessionExercise" ("exerciseEnergyTimingProfileId");

CREATE INDEX IF NOT EXISTS "WorkoutSessionExercise_energy_status_idx"
  ON "WorkoutSessionExercise" ("energyEstimateStatus");

-- repetitionMode restoration from canonical catalog (explicit fields only; IS NULL guard)
