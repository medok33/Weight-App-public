-- 208: WORKOUT-V2-01B workout hub and profile foundation.
-- Custom SQL migration: additive, non-destructive and safe to re-run.

CREATE TABLE IF NOT EXISTS "WorkoutProfile" (
  "userId" uuid PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "trainingLevel" text NOT NULL,
  "trainingPlace" text NOT NULL DEFAULT 'HOME',
  "workoutsPerWeek" integer NOT NULL DEFAULT 3,
  "preferredDuration" text NOT NULL DEFAULT 'STANDARD',
  "availableDaysJson" jsonb NOT NULL DEFAULT '[0,2,4]'::jsonb,
  "workoutEquipmentJson" jsonb NOT NULL DEFAULT '["NONE","BODYWEIGHT"]'::jsonb,
  "preferredActivityTypesJson" jsonb NOT NULL DEFAULT '["strength","walking","mobility"]'::jsonb,
  "excludedExerciseKeysJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutProfile_trainingLevel_check"
    CHECK ("trainingLevel" IN ('BEGINNER','INTERMEDIATE','ADVANCED')),
  CONSTRAINT "WorkoutProfile_trainingPlace_check"
    CHECK ("trainingPlace" IN ('HOME','GYM','MIXED')),
  CONSTRAINT "WorkoutProfile_workoutsPerWeek_check"
    CHECK ("workoutsPerWeek" BETWEEN 2 AND 5),
  CONSTRAINT "WorkoutProfile_preferredDuration_check"
    CHECK ("preferredDuration" IN ('SHORT','STANDARD','LONG'))
);

ALTER TABLE "Exercise"
  ADD COLUMN IF NOT EXISTS "displayNameRu" text,
  ADD COLUMN IF NOT EXISTS "displayNameEn" text,
  ADD COLUMN IF NOT EXISTS "techniqueSummaryRu" text,
  ADD COLUMN IF NOT EXISTS "techniqueSummaryEn" text,
  ADD COLUMN IF NOT EXISTS "commonMistakeRu" text,
  ADD COLUMN IF NOT EXISTS "commonMistakeEn" text,
  ADD COLUMN IF NOT EXISTS "easierVariantKey" text,
  ADD COLUMN IF NOT EXISTS "estimatedMinutes" integer;

CREATE TABLE IF NOT EXISTS "ExerciseMedia" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseId" uuid NOT NULL REFERENCES "Exercise"(id) ON DELETE CASCADE,
  "mediaType" text NOT NULL CHECK ("mediaType" IN ('image','video')),
  role text NOT NULL CHECK (role IN ('cover','technique_step')),
  "storageKey" text,
  "mediaAssetId" uuid REFERENCES "MediaAsset"(id) ON DELETE SET NULL,
  locale text,
  "altText" text NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  provenance text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ExerciseMedia_exerciseId_idx" ON "ExerciseMedia"("exerciseId");

CREATE TABLE IF NOT EXISTS "WorkoutPlanDayOverride" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "workoutPlanId" uuid NOT NULL REFERENCES "WorkoutPlan"(id) ON DELETE CASCADE,
  "dayIndex" integer NOT NULL CHECK ("dayIndex" BETWEEN 0 AND 6),
  "replacementType" text NOT NULL,
  "replacementDayTitle" text,
  "replacementSnapshotJson" jsonb NOT NULL,
  "moveTargetDayIndex" integer CHECK ("moveTargetDayIndex" IS NULL OR "moveTargetDayIndex" BETWEEN 0 AND 6),
  reason text,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user','system')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reverted')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "revertedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS "WorkoutPlanDayOverride_userId_idx"
  ON "WorkoutPlanDayOverride"("userId");
CREATE INDEX IF NOT EXISTS "WorkoutPlanDayOverride_workoutPlanId_idx"
  ON "WorkoutPlanDayOverride"("workoutPlanId");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutPlanDayOverride_active_day_uidx"
  ON "WorkoutPlanDayOverride"("workoutPlanId", "dayIndex") WHERE status = 'active';

INSERT INTO "Exercise" (
  id, name, "riskLevel", key, "nameRu", "nameEn", "displayNameRu", "displayNameEn",
  "techniqueSummaryRu", "techniqueSummaryEn", "commonMistakeRu", "commonMistakeEn",
  "movementPattern", difficulty, "equipmentCodesJson", "muscleGroupsJson",
  "easierVariantKey", "estimatedMinutes", "isActive"
) VALUES
  (gen_random_uuid(),'morning_walk','low','morning_walk','Утренняя ходьба','Morning walk','Утренняя ходьба','Morning walk','Идите в удобном темпе, сохраняя ровное дыхание.','Walk at a comfortable pace with steady breathing.','Слишком быстрый старт.','Starting too fast.','cardio','BEGINNER','["NONE"]','["cardio"]',NULL,10,true),
  (gen_random_uuid(),'bodyweight_squats','low','bodyweight_squats','Приседания с весом тела','Bodyweight squats','Приседания','Bodyweight squats','Отводите таз назад, колени направляйте по линии стоп.','Sit hips back and track knees over feet.','Колени заваливаются внутрь.','Knees collapsing inward.','squat','BEGINNER','["BODYWEIGHT"]','["quads","glutes"]',NULL,5,true),
  (gen_random_uuid(),'stretching','low','stretching','Растяжка','Stretching','Мягкая растяжка','Gentle stretching','Двигайтесь плавно, без боли и рывков.','Move smoothly without pain or bouncing.','Растяжка через боль.','Stretching through pain.','mobility','BEGINNER','["NONE"]','["mobility"]',NULL,5,true),
  (gen_random_uuid(),'light_jog','medium','light_jog','Лёгкий бег','Light jog','Лёгкий бег','Light jog','Держите разговорный темп и мягко ставьте стопу.','Keep a conversational pace and land softly.','Слишком высокий темп.','Running too fast.','cardio','INTERMEDIATE','["NONE"]','["cardio"]','morning_walk',10,true),
  (gen_random_uuid(),'core_plank','low','core_plank','Планка','Core plank','Планка','Plank','Сохраняйте прямую линию от головы до пяток.','Keep a straight line from head to heels.','Провисание поясницы.','Sagging lower back.','core','BEGINNER','["BODYWEIGHT"]','["core"]','dead_bug',4,true),
  (gen_random_uuid(),'mobility_flow','low','mobility_flow','Комплекс на подвижность','Mobility flow','Комплекс на подвижность','Mobility flow','Чередуйте плавные движения в комфортной амплитуде.','Flow smoothly through a comfortable range.','Резкие движения.','Jerky movements.','mobility','BEGINNER','["NONE"]','["mobility"]','stretching',6,true),
  (gen_random_uuid(),'recovery_walk','low','recovery_walk','Восстановительная ходьба','Recovery walk','Восстановительная прогулка','Recovery walk','Идите спокойно и не допускайте одышки.','Walk easily without becoming breathless.','Ускорение до утомления.','Pushing to fatigue.','cardio','BEGINNER','["NONE"]','["cardio"]','morning_walk',10,true),
  (gen_random_uuid(),'push_ups','low','push_ups','Отжимания','Push-ups','Отжимания','Push-ups','Держите корпус ровно, локти направляйте назад.','Keep the body straight and elbows angled back.','Локти разведены в стороны.','Elbows flaring out.','push','BEGINNER','["BODYWEIGHT"]','["chest","triceps"]',NULL,5,true),
  (gen_random_uuid(),'glute_bridge','low','glute_bridge','Ягодичный мост','Glute bridge','Ягодичный мост','Glute bridge','Поднимайте таз усилием ягодиц без прогиба в пояснице.','Lift hips with the glutes without arching the back.','Переразгибание поясницы.','Overarching the lower back.','hinge','BEGINNER','["BODYWEIGHT"]','["glutes","hamstrings"]',NULL,5,true),
  (gen_random_uuid(),'dead_bug','low','dead_bug','Жук на спине','Dead bug','Жук на спине','Dead bug','Прижимайте поясницу к полу и двигайтесь медленно.','Press the lower back down and move slowly.','Поясница отрывается от пола.','Lower back lifting.','core','BEGINNER','["BODYWEIGHT"]','["core"]',NULL,5,true),
  (gen_random_uuid(),'band_row','low','band_row','Тяга эспандера','Band row','Тяга эспандера','Band row','Тяните локти назад, сводя лопатки.','Pull elbows back and squeeze shoulder blades.','Подъём плеч к ушам.','Shrugging shoulders.','pull','BEGINNER','["RESISTANCE_BAND"]','["back","biceps"]',NULL,5,true),
  (gen_random_uuid(),'band_pull_apart','low','band_pull_apart','Разведение эспандера','Band pull-apart','Разведение эспандера','Band pull-apart','Разводите руки, сохраняя рёбра опущенными.','Pull the band apart while keeping ribs down.','Прогиб в пояснице.','Arching the lower back.','pull','BEGINNER','["RESISTANCE_BAND"]','["upper_back","rear_delts"]',NULL,4,true),
  (gen_random_uuid(),'dumbbell_row','medium','dumbbell_row','Тяга гантели','Dumbbell row','Тяга гантели','Dumbbell row','Сохраняйте спину нейтральной и ведите локоть к тазу.','Keep a neutral back and row elbow toward the hip.','Скручивание корпуса.','Twisting the torso.','pull','INTERMEDIATE','["DUMBBELL"]','["back","biceps"]','band_row',5,true),
  (gen_random_uuid(),'goblet_squat','medium','goblet_squat','Приседание с гантелью','Goblet squat','Приседание с гантелью','Goblet squat','Держите вес у груди и приседайте с ровной спиной.','Hold the weight at chest and squat with a neutral back.','Отрыв пяток.','Heels lifting.','squat','INTERMEDIATE','["DUMBBELL"]','["quads","glutes"]','bodyweight_squats',5,true),
  (gen_random_uuid(),'machine_leg_press','medium','machine_leg_press','Жим ногами в тренажёре','Machine leg press','Жим ногами','Machine leg press','Прижмите спину и разгибайте ноги без блокировки коленей.','Keep back supported and avoid locking knees.','Слишком глубокое опускание платформы.','Lowering the platform too far.','squat','BEGINNER','["GYM_MACHINES"]','["quads","glutes"]','bodyweight_squats',6,true),
  (gen_random_uuid(),'cable_row','medium','cable_row','Тяга нижнего блока','Cable row','Тяга нижнего блока','Cable row','Тяните рукоять к корпусу, не отклоняясь назад.','Row the handle in without leaning back.','Раскачивание корпуса.','Rocking the torso.','pull','BEGINNER','["GYM_MACHINES"]','["back","biceps"]','band_row',5,true),
  (gen_random_uuid(),'treadmill_walk','low','treadmill_walk','Ходьба на дорожке','Treadmill walk','Ходьба на дорожке','Treadmill walk','Выберите спокойный темп и держите корпус прямо.','Choose an easy pace and stay upright.','Постоянная опора на поручни.','Leaning on the rails.','cardio','BEGINNER','["CARDIO_MACHINE"]','["cardio"]','morning_walk',10,true),
  (gen_random_uuid(),'chest_press_machine','medium','chest_press_machine','Жим от груди в тренажёре','Machine chest press','Жим от груди','Machine chest press','Прижмите спину и плавно выжимайте рукояти.','Keep back supported and press smoothly.','Плечи подняты к ушам.','Shrugging shoulders.','push','BEGINNER','["GYM_MACHINES"]','["chest","triceps"]','push_ups',5,true),
  (gen_random_uuid(),'barbell_romanian_deadlift','medium','barbell_romanian_deadlift','Румынская тяга со штангой','Barbell Romanian deadlift','Румынская тяга','Barbell Romanian deadlift','Отводите таз назад и держите штангу близко к ногам.','Hinge hips back and keep the bar close.','Округление спины.','Rounding the back.','hinge','INTERMEDIATE','["BARBELL"]','["hamstrings","glutes"]','glute_bridge',6,true),
  (gen_random_uuid(),'lat_pulldown','medium','lat_pulldown','Тяга верхнего блока','Lat pulldown','Тяга верхнего блока','Lat pulldown','Тяните рукоять к верхней части груди, опуская лопатки.','Pull toward upper chest while lowering shoulder blades.','Тяга за голову.','Pulling behind the neck.','pull','BEGINNER','["GYM_MACHINES"]','["back","biceps"]','band_row',5,true)
ON CONFLICT (key) WHERE key IS NOT NULL DO UPDATE SET
  "nameRu" = EXCLUDED."nameRu", "nameEn" = EXCLUDED."nameEn",
  "displayNameRu" = EXCLUDED."displayNameRu", "displayNameEn" = EXCLUDED."displayNameEn",
  "techniqueSummaryRu" = EXCLUDED."techniqueSummaryRu",
  "techniqueSummaryEn" = EXCLUDED."techniqueSummaryEn",
  "commonMistakeRu" = EXCLUDED."commonMistakeRu",
  "commonMistakeEn" = EXCLUDED."commonMistakeEn",
  "movementPattern" = EXCLUDED."movementPattern", difficulty = EXCLUDED.difficulty,
  "equipmentCodesJson" = EXCLUDED."equipmentCodesJson",
  "muscleGroupsJson" = EXCLUDED."muscleGroupsJson",
  "easierVariantKey" = EXCLUDED."easierVariantKey",
  "estimatedMinutes" = EXCLUDED."estimatedMinutes", "isActive" = true;
