-- 219: WORKOUT-CATALOG-V3-01A taxonomy / schema foundation (+ FIX-01 invariants)
-- Additive. Does not amend 1–218. Safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- Schema + vocabulary seed only — NO classification backfill of 84,
-- NO generator behavior change, NO energy/timing/media content mutation.
--
-- REVISION-SEMANTIC side tables (taxonomy / muscle / equipment):
--   writable only while parent ExerciseRevision is NOT ever-approved
--   (mutable pre-approval lifecycle: CANDIDATE/DRAFT/*_REVIEW).
--   After APPROVED/RETIRED (or release pin / approvedAt): INSERT/UPDATE/DELETE blocked.
-- OPERATIONAL readiness (ExerciseRevisionReadiness): remains mutable so
--   energy/timing/media/generator gates can flip without fake new revisions.
-- Not applied to shared/staging/production in this package.

-- ---------------------------------------------------------------------------
-- Vocabulary (S5 + FIX-01 LOW): FK-backed codes, no fake UNKNOWN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WorkoutCatalogMuscleCode" (
  code text PRIMARY KEY,
  "displayNameEn" text NOT NULL,
  "displayNameRu" text,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutCatalogMuscleCode_code_nonempty_chk"
    CHECK (char_length(trim(code)) > 0)
);

CREATE TABLE IF NOT EXISTS "WorkoutCatalogMovementPatternCode" (
  code text PRIMARY KEY,
  "displayNameEn" text NOT NULL,
  "displayNameRu" text,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutCatalogMovementPatternCode_code_nonempty_chk"
    CHECK (char_length(trim(code)) > 0)
);

CREATE TABLE IF NOT EXISTS "WorkoutCatalogEquipmentCode" (
  code text PRIMARY KEY,
  "displayNameEn" text NOT NULL,
  "displayNameRu" text,
  "legacyAliasOf" text,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutCatalogEquipmentCode_code_nonempty_chk"
    CHECK (char_length(trim(code)) > 0)
);

INSERT INTO "WorkoutCatalogMuscleCode" (code, "displayNameEn", "displayNameRu", active)
VALUES
  ('CHEST', 'Chest', 'Грудь', true),
  ('LATS', 'Lats', 'Широчайшие', true),
  ('UPPER_BACK', 'Upper back', 'Верх спины', true),
  ('TRAPS', 'Traps', 'Трапеции', true),
  ('FRONT_DELTS', 'Front delts', 'Передние дельты', true),
  ('SIDE_DELTS', 'Side delts', 'Средние дельты', true),
  ('REAR_DELTS', 'Rear delts', 'Задние дельты', true),
  ('BICEPS', 'Biceps', 'Бицепс', true),
  ('TRICEPS', 'Triceps', 'Трицепс', true),
  ('FOREARMS_GRIP', 'Forearms / grip', 'Предплечья / хват', true),
  ('QUADS', 'Quads', 'Квадрицепс', true),
  ('HAMSTRINGS', 'Hamstrings', 'Бицепс бедра', true),
  ('GLUTES', 'Glutes', 'Ягодицы', true),
  ('ADDUCTORS', 'Adductors', 'Приводящие', true),
  ('ABDUCTORS', 'Abductors', 'Отводящие', true),
  ('CALVES', 'Calves', 'Икры', true),
  ('TIBIALIS', 'Tibialis', 'Передняя большеберцовая', true),
  ('ABS', 'Abs', 'Прямая мышца живота', true),
  ('OBLIQUES', 'Obliques', 'Косые', true),
  ('DEEP_CORE', 'Deep core', 'Глубокий кор', true),
  ('LOWER_BACK', 'Lower back', 'Низ спины', true),
  ('HIP_FLEXORS', 'Hip flexors', 'Сгибатели бедра', true),
  ('CONDITIONING_SYSTEMIC', 'Conditioning (systemic)', 'Кондиция (системно)', true),
  ('MOBILITY_SYSTEMIC', 'Mobility (systemic)', 'Мобильность (системно)', true),
  ('RECOVERY_SYSTEMIC', 'Recovery (systemic)', 'Восстановление (системно)', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "WorkoutCatalogMovementPatternCode" (code, "displayNameEn", "displayNameRu", active)
VALUES
  ('HORIZONTAL_PUSH', 'Horizontal push', 'Горизонтальный жим', true),
  ('VERTICAL_PUSH', 'Vertical push', 'Вертикальный жим', true),
  ('HORIZONTAL_PULL', 'Horizontal pull', 'Горизонтальная тяга', true),
  ('VERTICAL_PULL', 'Vertical pull', 'Вертикальная тяга', true),
  ('SQUAT', 'Squat', 'Присед', true),
  ('HINGE', 'Hinge', 'Наклон / hinge', true),
  ('LUNGE', 'Lunge', 'Выпад', true),
  ('KNEE_EXTENSION', 'Knee extension', 'Разгибание колена', true),
  ('KNEE_FLEXION', 'Knee flexion', 'Сгибание колена', true),
  ('HIP_EXTENSION', 'Hip extension', 'Разгибание бедра', true),
  ('HIP_ABDUCTION', 'Hip abduction', 'Отведение бедра', true),
  ('HIP_ADDUCTION', 'Hip adduction', 'Приведение бедра', true),
  ('CALF_RAISE', 'Calf raise', 'Подъём на носки', true),
  ('CARRY', 'Carry', 'Перенос', true),
  ('CORE_FLEXION', 'Core flexion', 'Сгибание кора', true),
  ('CORE_ANTI_EXTENSION', 'Core anti-extension', 'Антиэкстензия кора', true),
  ('CORE_ANTI_ROTATION', 'Core anti-rotation', 'Антиротация кора', true),
  ('CORE_ROTATION', 'Core rotation', 'Ротация кора', true),
  ('LOCOMOTION', 'Locomotion', 'Локомоция', true),
  ('JUMP', 'Jump', 'Прыжок', true),
  ('CONDITIONING', 'Conditioning', 'Кондиция', true),
  ('MOBILITY', 'Mobility', 'Мобильность', true),
  ('ELBOW_FLEXION', 'Elbow flexion', 'Сгибание локтя', true),
  ('ELBOW_EXTENSION', 'Elbow extension', 'Разгибание локтя', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "WorkoutCatalogEquipmentCode" (code, "displayNameEn", "displayNameRu", "legacyAliasOf", active)
VALUES
  ('NONE', 'None', 'Нет', NULL, true),
  ('BODYWEIGHT', 'Bodyweight', 'Собственный вес', NULL, true),
  ('RESISTANCE_BAND', 'Resistance band', 'Резиновая лента', NULL, true),
  ('DUMBBELL', 'Dumbbell', 'Гантель', NULL, true),
  ('KETTLEBELL', 'Kettlebell', 'Гиря', NULL, true),
  ('BENCH', 'Bench', 'Скамья', NULL, true),
  ('CHAIR', 'Chair', 'Стул', NULL, true),
  ('MAT', 'Mat', 'Коврик', NULL, true),
  ('PULLUP_BAR', 'Pull-up bar', 'Турник', NULL, true),
  ('PULL_UP_BAR', 'Pull-up bar (alias)', 'Турник', 'PULLUP_BAR', true),
  ('GYM_MACHINES', 'Gym machines (legacy aggregate)', 'Тренажёры (legacy)', NULL, true),
  ('CABLE', 'Cable', 'Кроссовер/блок', NULL, true),
  ('BARBELL', 'Barbell', 'Штанга', NULL, true),
  ('CARDIO_MACHINE', 'Cardio machine (legacy aggregate)', 'Кардио-тренажёр (legacy)', NULL, true),
  ('EZ_BAR', 'EZ bar', 'EZ-гриф', NULL, true),
  ('SQUAT_RACK', 'Squat rack', 'Стойка для приседаний', NULL, true),
  ('SMITH_MACHINE', 'Smith machine', 'Машина Смита', NULL, true),
  ('LEG_PRESS', 'Leg press', 'Жим ногами', NULL, true),
  ('HACK_SQUAT', 'Hack squat', 'Гакк-приседания', NULL, true),
  ('LEG_EXTENSION_MACHINE', 'Leg extension machine', 'Разгибание ног', NULL, true),
  ('LEG_CURL_MACHINE', 'Leg curl machine', 'Сгибание ног', NULL, true),
  ('CHEST_PRESS_MACHINE', 'Chest press machine', 'Жим от груди в тренажёре', NULL, true),
  ('ROW_MACHINE', 'Row machine', 'Горизонтальная тяга', NULL, true),
  ('LAT_PULLDOWN', 'Lat pulldown', 'Тяга верхнего блока', NULL, true),
  ('PEC_DECK', 'Pec deck', 'Пек-дек', NULL, true),
  ('HIP_ABDUCTION_MACHINE', 'Hip abduction machine', 'Отведения бёдер', NULL, true),
  ('HIP_ADDUCTION_MACHINE', 'Hip adduction machine', 'Сведения бёдер', NULL, true),
  ('CALF_MACHINE', 'Calf machine', 'Икры в тренажёре', NULL, true),
  ('BOX_STEP', 'Box / step', 'Тумба / степ', NULL, true),
  ('JUMP_ROPE', 'Jump rope', 'Скакалка', NULL, true),
  ('TREADMILL', 'Treadmill', 'Беговая дорожка', NULL, true),
  ('BIKE', 'Exercise bike', 'Велотренажёр', NULL, true),
  ('ELLIPTICAL', 'Elliptical', 'Эллипс', NULL, true),
  ('ROW_ERG', 'Rowing ergometer', 'Гребной тренажёр', NULL, true),
  ('STAIR_CLIMBER', 'Stair climber', 'Степпер / лестница', NULL, true),
  ('FOAM_ROLLER', 'Foam roller', 'Массажный ролл', NULL, true),
  ('AB_WHEEL', 'Ab wheel', 'Ролик для пресса', NULL, true),
  ('BATTLE_ROPES', 'Battle ropes', 'Канаты', NULL, true),
  ('SLED', 'Sled', 'Сани', NULL, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- S2 / S3 / S11: revision taxonomy side-row (nullable; no fake defaults)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseRevisionTaxonomy" (
  "exerciseRevisionId" uuid PRIMARY KEY
    REFERENCES "ExerciseRevision"(id) ON DELETE CASCADE,
  "primaryMovementPattern" text
    REFERENCES "WorkoutCatalogMovementPatternCode"(code) ON DELETE RESTRICT,
  "secondaryMovementPattern" text
    REFERENCES "WorkoutCatalogMovementPatternCode"(code) ON DELETE RESTRICT,
  "trainingRole" text,
  "progressionGroup" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseRevisionTaxonomy_trainingRole_chk"
    CHECK (
      "trainingRole" IS NULL
      OR "trainingRole" IN (
        'MAIN','ACCESSORY','ISOLATION','CONDITIONING','WARMUP','MOBILITY','RECOVERY'
      )
    ),
  CONSTRAINT "ExerciseRevisionTaxonomy_pattern_distinct_chk"
    CHECK (
      "primaryMovementPattern" IS NULL
      OR "secondaryMovementPattern" IS NULL
      OR "primaryMovementPattern" <> "secondaryMovementPattern"
    )
);

CREATE INDEX IF NOT EXISTS "ExerciseRevisionTaxonomy_trainingRole_idx"
  ON "ExerciseRevisionTaxonomy" ("trainingRole");
CREATE INDEX IF NOT EXISTS "ExerciseRevisionTaxonomy_progressionGroup_idx"
  ON "ExerciseRevisionTaxonomy" ("progressionGroup");
CREATE INDEX IF NOT EXISTS "ExerciseRevisionTaxonomy_primaryMovementPattern_idx"
  ON "ExerciseRevisionTaxonomy" ("primaryMovementPattern");

-- Idempotent FK attach if table pre-existed without vocabulary FKs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseRevisionTaxonomy_primaryMovementPattern_fkey'
  ) THEN
    ALTER TABLE "ExerciseRevisionTaxonomy"
      ADD CONSTRAINT "ExerciseRevisionTaxonomy_primaryMovementPattern_fkey"
      FOREIGN KEY ("primaryMovementPattern")
      REFERENCES "WorkoutCatalogMovementPatternCode"(code)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseRevisionTaxonomy_secondaryMovementPattern_fkey'
  ) THEN
    ALTER TABLE "ExerciseRevisionTaxonomy"
      ADD CONSTRAINT "ExerciseRevisionTaxonomy_secondaryMovementPattern_fkey"
      FOREIGN KEY ("secondaryMovementPattern")
      REFERENCES "WorkoutCatalogMovementPatternCode"(code)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- S1: muscle involvement
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseRevisionMuscleInvolvement" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseRevisionId" uuid NOT NULL
    REFERENCES "ExerciseRevision"(id) ON DELETE CASCADE,
  "muscleCode" text NOT NULL
    REFERENCES "WorkoutCatalogMuscleCode"(code) ON DELETE RESTRICT,
  involvement text NOT NULL
    CHECK (involvement IN ('PRIMARY', 'SECONDARY')),
  "sortOrder" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseRevisionMuscleInvolvement_revision_muscle_uidx"
    UNIQUE ("exerciseRevisionId", "muscleCode")
);

CREATE INDEX IF NOT EXISTS "ExerciseRevisionMuscleInvolvement_revision_idx"
  ON "ExerciseRevisionMuscleInvolvement" ("exerciseRevisionId");
CREATE INDEX IF NOT EXISTS "ExerciseRevisionMuscleInvolvement_muscle_idx"
  ON "ExerciseRevisionMuscleInvolvement" ("muscleCode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseRevisionMuscleInvolvement_muscleCode_fkey'
  ) THEN
    ALTER TABLE "ExerciseRevisionMuscleInvolvement"
      ADD CONSTRAINT "ExerciseRevisionMuscleInvolvement_muscleCode_fkey"
      FOREIGN KEY ("muscleCode")
      REFERENCES "WorkoutCatalogMuscleCode"(code)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- S4: equipment requirement groups + items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseRevisionEquipmentGroup" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseRevisionId" uuid NOT NULL
    REFERENCES "ExerciseRevision"(id) ON DELETE CASCADE,
  "groupKind" text NOT NULL
    CHECK ("groupKind" IN ('ALL_OF', 'ANY_OF', 'OPTIONAL')),
  "sortOrder" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseRevisionEquipmentGroup_revision_order_uidx"
    UNIQUE ("exerciseRevisionId", "sortOrder")
);

CREATE INDEX IF NOT EXISTS "ExerciseRevisionEquipmentGroup_revision_idx"
  ON "ExerciseRevisionEquipmentGroup" ("exerciseRevisionId");

CREATE TABLE IF NOT EXISTS "ExerciseRevisionEquipmentItem" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "groupId" uuid NOT NULL
    REFERENCES "ExerciseRevisionEquipmentGroup"(id) ON DELETE CASCADE,
  "equipmentCode" text NOT NULL
    REFERENCES "WorkoutCatalogEquipmentCode"(code) ON DELETE RESTRICT,
  "sortOrder" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseRevisionEquipmentItem_group_code_uidx"
    UNIQUE ("groupId", "equipmentCode")
);

CREATE INDEX IF NOT EXISTS "ExerciseRevisionEquipmentItem_group_idx"
  ON "ExerciseRevisionEquipmentItem" ("groupId");
CREATE INDEX IF NOT EXISTS "ExerciseRevisionEquipmentItem_code_idx"
  ON "ExerciseRevisionEquipmentItem" ("equipmentCode");

-- ---------------------------------------------------------------------------
-- S9: readiness stubs (OPERATIONAL_MUTABLE; null = unset; not semantic freeze)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseRevisionReadiness" (
  "exerciseRevisionId" uuid PRIMARY KEY
    REFERENCES "ExerciseRevision"(id) ON DELETE CASCADE,
  "catalogReady" boolean,
  "generatorReady" boolean,
  "energyReady" boolean,
  "timingReady" boolean,
  "mediaReady" boolean,
  notes text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- FIX-01: revision-semantic immutability (PostgreSQL-level)
-- Uses existing workout_catalog_revision_id_ever_approved() from migration 210.
-- Mutable pre-approval states: CANDIDATE, DRAFT, TECHNIQUE_REVIEW, SAFETY_REVIEW, MEDIA_REVIEW
-- (writable only when ever_approved = false).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workout_catalog_v3_revision_semantic_mutable(p_revision_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_revision_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN NOT workout_catalog_revision_id_ever_approved(p_revision_id);
END;
$$;

CREATE OR REPLACE FUNCTION workout_catalog_v3_assert_revision_semantic_mutable(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT workout_catalog_v3_revision_semantic_mutable(p_revision_id) THEN
    RAISE EXCEPTION 'V3_REVISION_SEMANTIC_IMMUTABLE';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION workout_catalog_v3_taxonomy_semantic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(OLD."exerciseRevisionId");
    RETURN OLD;
  END IF;
  PERFORM workout_catalog_v3_assert_revision_semantic_mutable(NEW."exerciseRevisionId");
  IF TG_OP = 'UPDATE' AND NEW."exerciseRevisionId" IS DISTINCT FROM OLD."exerciseRevisionId" THEN
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(OLD."exerciseRevisionId");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseRevisionTaxonomy_semantic_guard" ON "ExerciseRevisionTaxonomy";
CREATE TRIGGER "ExerciseRevisionTaxonomy_semantic_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ExerciseRevisionTaxonomy"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_v3_taxonomy_semantic_guard();

CREATE OR REPLACE FUNCTION workout_catalog_v3_muscle_semantic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(OLD."exerciseRevisionId");
    RETURN OLD;
  END IF;
  PERFORM workout_catalog_v3_assert_revision_semantic_mutable(NEW."exerciseRevisionId");
  IF TG_OP = 'UPDATE' AND NEW."exerciseRevisionId" IS DISTINCT FROM OLD."exerciseRevisionId" THEN
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(OLD."exerciseRevisionId");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseRevisionMuscleInvolvement_semantic_guard"
  ON "ExerciseRevisionMuscleInvolvement";
CREATE TRIGGER "ExerciseRevisionMuscleInvolvement_semantic_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ExerciseRevisionMuscleInvolvement"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_v3_muscle_semantic_guard();

CREATE OR REPLACE FUNCTION workout_catalog_v3_equipment_group_semantic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(OLD."exerciseRevisionId");
    RETURN OLD;
  END IF;
  PERFORM workout_catalog_v3_assert_revision_semantic_mutable(NEW."exerciseRevisionId");
  IF TG_OP = 'UPDATE' AND NEW."exerciseRevisionId" IS DISTINCT FROM OLD."exerciseRevisionId" THEN
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(OLD."exerciseRevisionId");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseRevisionEquipmentGroup_semantic_guard"
  ON "ExerciseRevisionEquipmentGroup";
CREATE TRIGGER "ExerciseRevisionEquipmentGroup_semantic_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ExerciseRevisionEquipmentGroup"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_v3_equipment_group_semantic_guard();

CREATE OR REPLACE FUNCTION workout_catalog_v3_equipment_item_semantic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rev_id uuid;
  old_rev_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT g."exerciseRevisionId" INTO rev_id
    FROM "ExerciseRevisionEquipmentGroup" g WHERE g.id = OLD."groupId";
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(rev_id);
    RETURN OLD;
  END IF;

  SELECT g."exerciseRevisionId" INTO rev_id
  FROM "ExerciseRevisionEquipmentGroup" g WHERE g.id = NEW."groupId";
  IF rev_id IS NULL THEN
    RAISE EXCEPTION 'V3_REVISION_SEMANTIC_IMMUTABLE';
  END IF;
  PERFORM workout_catalog_v3_assert_revision_semantic_mutable(rev_id);

  IF TG_OP = 'UPDATE' AND NEW."groupId" IS DISTINCT FROM OLD."groupId" THEN
    SELECT g."exerciseRevisionId" INTO old_rev_id
    FROM "ExerciseRevisionEquipmentGroup" g WHERE g.id = OLD."groupId";
    PERFORM workout_catalog_v3_assert_revision_semantic_mutable(old_rev_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseRevisionEquipmentItem_semantic_guard"
  ON "ExerciseRevisionEquipmentItem";
CREATE TRIGGER "ExerciseRevisionEquipmentItem_semantic_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ExerciseRevisionEquipmentItem"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_v3_equipment_item_semantic_guard();

-- ---------------------------------------------------------------------------
-- FIX-01 MEDIUM: persisted equipment groups must be non-empty at COMMIT
-- DEFERRABLE so group+items can be created in one transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workout_catalog_v3_equipment_group_nonempty_deferred()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gids uuid[] := ARRAY[]::uuid[];
  gid uuid;
  cnt int;
BEGIN
  IF TG_TABLE_NAME = 'ExerciseRevisionEquipmentGroup' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    gids := array_append(gids, NEW.id);
  ELSE
    IF TG_OP = 'DELETE' THEN
      gids := array_append(gids, OLD."groupId");
    ELSIF TG_OP = 'UPDATE' THEN
      gids := array_append(gids, NEW."groupId");
      IF OLD."groupId" IS DISTINCT FROM NEW."groupId" THEN
        gids := array_append(gids, OLD."groupId");
      END IF;
    ELSE
      gids := array_append(gids, NEW."groupId");
    END IF;
  END IF;

  FOREACH gid IN ARRAY gids LOOP
    IF gid IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "ExerciseRevisionEquipmentGroup" g WHERE g.id = gid
    ) THEN
      CONTINUE;
    END IF;
    SELECT COUNT(*)::int INTO cnt
    FROM "ExerciseRevisionEquipmentItem" i
    WHERE i."groupId" = gid;
    IF cnt < 1 THEN
      RAISE EXCEPTION 'V3_EQUIPMENT_GROUP_EMPTY';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseRevisionEquipmentGroup_nonempty_deferred"
  ON "ExerciseRevisionEquipmentGroup";
CREATE CONSTRAINT TRIGGER "ExerciseRevisionEquipmentGroup_nonempty_deferred"
  AFTER INSERT OR UPDATE OR DELETE ON "ExerciseRevisionEquipmentGroup"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_v3_equipment_group_nonempty_deferred();

DROP TRIGGER IF EXISTS "ExerciseRevisionEquipmentItem_nonempty_deferred"
  ON "ExerciseRevisionEquipmentItem";
CREATE CONSTRAINT TRIGGER "ExerciseRevisionEquipmentItem_nonempty_deferred"
  AFTER INSERT OR UPDATE OR DELETE ON "ExerciseRevisionEquipmentItem"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_v3_equipment_group_nonempty_deferred();

-- Self-link on ExerciseVariantRelation: already enforced by migration 210
-- constraint ExerciseVariantRelation_no_self. Do NOT add a redundant twin.
