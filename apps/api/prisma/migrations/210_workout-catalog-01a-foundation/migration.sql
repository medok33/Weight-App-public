-- 210: WORKOUT-CATALOG-01A catalog foundation (families, revisions, safety,
-- provenance, variant graph, immutable published releases, bootstrap release).
-- Custom SQL migration: additive, non-destructive and safe to re-run.

-- ---------------------------------------------------------------------------
-- A. ExerciseFamily
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseFamily" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  "nameRu" text NOT NULL,
  "nameEn" text NOT NULL,
  "movementPattern" text NOT NULL,
  "internalNote" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseFamily_slug_key" UNIQUE (slug)
);

-- ---------------------------------------------------------------------------
-- B. Exercise identity extensions (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE "Exercise"
  ADD COLUMN IF NOT EXISTS "familyId" uuid REFERENCES "ExerciseFamily"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Exercise_familyId_idx" ON "Exercise"("familyId");

-- ---------------------------------------------------------------------------
-- C. ExerciseRevision
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseRevision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseId" uuid NOT NULL REFERENCES "Exercise"(id) ON DELETE CASCADE,
  "revisionNumber" integer NOT NULL CHECK ("revisionNumber" >= 1),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'CANDIDATE','DRAFT','TECHNIQUE_REVIEW','SAFETY_REVIEW','MEDIA_REVIEW','APPROVED','RETIRED'
    )),
  "nameRu" text NOT NULL,
  "nameEn" text NOT NULL,
  "techniqueRu" text,
  "techniqueEn" text,
  "commonMistakeRu" text,
  "commonMistakeEn" text,
  "easierVariantRu" text,
  "easierVariantEn" text,
  "harderVariantRu" text,
  "harderVariantEn" text,
  "breathingRu" text,
  "breathingEn" text,
  "stopConditionsRu" text,
  "stopConditionsEn" text,
  "defaultSets" integer,
  "defaultRepsMin" integer,
  "defaultRepsMax" integer,
  "defaultDurationSeconds" integer,
  "defaultRestSeconds" integer,
  "estimatedDurationSeconds" integer,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" text NOT NULL DEFAULT 'system:workout-catalog-01a',
  "reviewedAt" timestamptz,
  "approvedAt" timestamptz,
  CONSTRAINT "ExerciseRevision_exercise_revision_uidx" UNIQUE ("exerciseId", "revisionNumber")
);

CREATE INDEX IF NOT EXISTS "ExerciseRevision_exerciseId_idx" ON "ExerciseRevision"("exerciseId");
CREATE INDEX IF NOT EXISTS "ExerciseRevision_status_idx" ON "ExerciseRevision"(status);

-- ---------------------------------------------------------------------------
-- D. ExerciseSafetyProfile (1:1 revision)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseSafetyProfile" (
  "exerciseRevisionId" uuid PRIMARY KEY REFERENCES "ExerciseRevision"(id) ON DELETE CASCADE,
  "kneeLoad" text NOT NULL CHECK ("kneeLoad" IN ('LOW','MODERATE','HIGH')),
  "shoulderLoad" text NOT NULL CHECK ("shoulderLoad" IN ('LOW','MODERATE','HIGH')),
  "spineLoad" text NOT NULL CHECK ("spineLoad" IN ('LOW','MODERATE','HIGH')),
  "impactLevel" text NOT NULL CHECK ("impactLevel" IN ('LOW','MODERATE','HIGH')),
  "balanceRequirement" text NOT NULL CHECK ("balanceRequirement" IN ('LOW','MODERATE','HIGH')),
  "floorRequired" boolean NOT NULL DEFAULT false,
  "overheadMovement" boolean NOT NULL DEFAULT false,
  "deepKneeFlexion" boolean NOT NULL DEFAULT false,
  "singleLeg" boolean NOT NULL DEFAULT false,
  "beginnerAllowed" boolean NOT NULL DEFAULT true,
  "requiresSpotter" boolean NOT NULL DEFAULT false,
  "internalSafetyNote" text
);

-- ---------------------------------------------------------------------------
-- E. Source / provenance foundation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseCatalogSource" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  "displayName" text NOT NULL,
  "sourceType" text NOT NULL
    CHECK ("sourceType" IN ('INTERNAL','PUBLIC_GUIDELINE','TEXTBOOK','PEER_REVIEWED','OTHER')),
  "baseUrl" text,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseCatalogSource_code_key" UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS "ExerciseSourceReference" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseRevisionId" uuid NOT NULL REFERENCES "ExerciseRevision"(id) ON DELETE CASCADE,
  "sourceId" uuid NOT NULL REFERENCES "ExerciseCatalogSource"(id) ON DELETE RESTRICT,
  "externalReference" text,
  "factualNotes" text,
  "accessedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ExerciseSourceReference_revision_idx"
  ON "ExerciseSourceReference"("exerciseRevisionId");

-- ---------------------------------------------------------------------------
-- F. Variant relation graph
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ExerciseVariantRelation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "fromExerciseId" uuid NOT NULL REFERENCES "Exercise"(id) ON DELETE CASCADE,
  "toExerciseId" uuid NOT NULL REFERENCES "Exercise"(id) ON DELETE CASCADE,
  "relationType" text NOT NULL
    CHECK ("relationType" IN (
      'EASIER','SAME_LEVEL','HARDER','EQUIPMENT_SWAP','NO_EQUIPMENT',
      'HOME_ALTERNATIVE','GYM_ALTERNATIVE','LOW_IMPACT','NO_FLOOR','QUIET_ALTERNATIVE'
    )),
  priority integer NOT NULL DEFAULT 100,
  "equipmentContext" text NOT NULL DEFAULT '',
  "placeContext" text NOT NULL DEFAULT '',
  "levelDelta" integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ExerciseVariantRelation_no_self" CHECK ("fromExerciseId" <> "toExerciseId"),
  CONSTRAINT "ExerciseVariantRelation_tuple_uidx"
    UNIQUE ("fromExerciseId", "toExerciseId", "relationType", "equipmentContext", "placeContext")
);

CREATE INDEX IF NOT EXISTS "ExerciseVariantRelation_from_idx"
  ON "ExerciseVariantRelation"("fromExerciseId") WHERE active = true;
CREATE INDEX IF NOT EXISTS "ExerciseVariantRelation_to_idx"
  ON "ExerciseVariantRelation"("toExerciseId") WHERE active = true;

-- ---------------------------------------------------------------------------
-- G. Catalog releases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "WorkoutCatalogRelease" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  "manifestVersion" text NOT NULL,
  "publishedAt" timestamptz,
  "retiredAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" text NOT NULL DEFAULT 'system:workout-catalog-01a',
  notes text,
  CONSTRAINT "WorkoutCatalogRelease_code_key" UNIQUE (code)
);

-- At most one current PUBLISHED release.
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutCatalogRelease_one_published_uidx"
  ON "WorkoutCatalogRelease"((status))
  WHERE status = 'PUBLISHED';

CREATE TABLE IF NOT EXISTS "WorkoutCatalogReleaseItem" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "releaseId" uuid NOT NULL REFERENCES "WorkoutCatalogRelease"(id) ON DELETE CASCADE,
  "exerciseId" uuid NOT NULL REFERENCES "Exercise"(id) ON DELETE RESTRICT,
  "exerciseRevisionId" uuid NOT NULL REFERENCES "ExerciseRevision"(id) ON DELETE RESTRICT,
  "familyId" uuid NOT NULL REFERENCES "ExerciseFamily"(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  "enabledForGenerator" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "WorkoutCatalogReleaseItem_release_exercise_uidx" UNIQUE ("releaseId", "exerciseId"),
  CONSTRAINT "WorkoutCatalogReleaseItem_release_ordinal_uidx" UNIQUE ("releaseId", ordinal)
);

CREATE INDEX IF NOT EXISTS "WorkoutCatalogReleaseItem_release_idx"
  ON "WorkoutCatalogReleaseItem"("releaseId");

-- ---------------------------------------------------------------------------
-- H. Plan provenance + optional media revision link
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkoutPlan"
  ADD COLUMN IF NOT EXISTS "workoutCatalogReleaseId" uuid
    REFERENCES "WorkoutCatalogRelease"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "workoutCatalogReleaseCode" text;

CREATE INDEX IF NOT EXISTS "WorkoutPlan_catalogRelease_idx"
  ON "WorkoutPlan"("workoutCatalogReleaseId");

ALTER TABLE "ExerciseMedia"
  ADD COLUMN IF NOT EXISTS "revisionId" uuid REFERENCES "ExerciseRevision"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reviewStatus" text,
  ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "altTextRu" text,
  ADD COLUMN IF NOT EXISTS "altTextEn" text,
  ADD COLUMN IF NOT EXISTS "promptVersion" text,
  ADD COLUMN IF NOT EXISTS "provider" text,
  ADD COLUMN IF NOT EXISTS "model" text;

CREATE INDEX IF NOT EXISTS "ExerciseMedia_revisionId_idx" ON "ExerciseMedia"("revisionId");

-- ---------------------------------------------------------------------------
-- I. Immutability + publish guards (FIX 2)
-- Permanent freeze after first approval (approvedAt / APPROVED / RETIRED /
-- release membership). RETIRED is terminal. Provenance + SafetyProfile share
-- the same ever-approved marker. PUBLISHED release must always retain >=1
-- generator-eligible item. Eligibility mutations serialize on advisory lock
-- 21000101 with publish.
-- ---------------------------------------------------------------------------

-- Shared catalog publish / eligibility-mutation lock (matches service constant).
CREATE OR REPLACE FUNCTION workout_catalog_acquire_publish_lock()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(21000101);
END;
$$;

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
    AND NEW."exerciseId" IS NOT DISTINCT FROM OLD."exerciseId"
    AND NEW."revisionNumber" IS NOT DISTINCT FROM OLD."revisionNumber"
    AND NEW."createdBy" IS NOT DISTINCT FROM OLD."createdBy"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
    AND NEW."reviewedAt" IS NOT DISTINCT FROM OLD."reviewedAt"
    AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt";
$$;

CREATE OR REPLACE FUNCTION workout_catalog_revision_ever_approved(rec "ExerciseRevision")
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF rec."approvedAt" IS NOT NULL THEN
    RETURN true;
  END IF;
  IF rec.status IN ('APPROVED', 'RETIRED') THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM "WorkoutCatalogReleaseItem" i WHERE i."exerciseRevisionId" = rec.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION workout_catalog_revision_id_ever_approved(p_revision_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  rec "ExerciseRevision";
BEGIN
  SELECT r.* INTO rec FROM "ExerciseRevision" r WHERE r.id = p_revision_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN workout_catalog_revision_ever_approved(rec);
END;
$$;

-- Canonical generator eligibility predicate (FIX 3).
-- Must stay equivalent across:
--   1) this function (DB eligible count + publish validation),
--   2) WorkoutCatalogReleaseService.listGeneratorEligibleExercises,
--   3) WorkoutCatalogReleaseService.assertReleasePublishable.
-- Predicate (per item, for a given release id):
--   enabledForGenerator
--   AND revision.status = APPROVED
--   AND revision.exerciseId = item.exerciseId
--   AND Exercise.id = item.exerciseId          (via JOIN)
--   AND Exercise.familyId IS NOT DISTINCT FROM item.familyId
--   AND Exercise.isActive IS TRUE
--   AND Exercise.key IS NOT NULL
-- Generator production query additionally requires release.status = PUBLISHED.
CREATE OR REPLACE FUNCTION workout_catalog_release_eligible_item_count(p_release_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM "WorkoutCatalogReleaseItem" i
  JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
  JOIN "Exercise" e ON e.id = i."exerciseId"
  WHERE i."releaseId" = p_release_id
    AND i."enabledForGenerator" = true
    AND r.status = 'APPROVED'
    AND r."exerciseId" = i."exerciseId"
    AND e."familyId" IS NOT DISTINCT FROM i."familyId"
    AND e."isActive" IS TRUE
    AND e.key IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION workout_catalog_revision_pinned_by_published(p_revision_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "WorkoutCatalogReleaseItem" i
    JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
    WHERE i."exerciseRevisionId" = p_revision_id
      AND rel.status = 'PUBLISHED'
  );
$$;

CREATE OR REPLACE FUNCTION workout_catalog_exercise_pinned_by_published_generator(p_exercise_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "WorkoutCatalogReleaseItem" i
    JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
    WHERE i."exerciseId" = p_exercise_id
      AND rel.status = 'PUBLISHED'
      AND i."enabledForGenerator" = true
  );
$$;

CREATE OR REPLACE FUNCTION workout_catalog_revision_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ever_approved boolean;
  pre_approval text[] := ARRAY[
    'CANDIDATE', 'DRAFT', 'TECHNIQUE_REVIEW', 'SAFETY_REVIEW', 'MEDIA_REVIEW'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF workout_catalog_revision_ever_approved(OLD) THEN
      RAISE EXCEPTION 'EXERCISE_REVISION_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."exerciseId" IS DISTINCT FROM OLD."exerciseId" THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_EXERCISE_ID_IMMUTABLE';
  END IF;
  IF NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber" THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_NUMBER_IMMUTABLE';
  END IF;

  -- RETIRED is terminal: no content/status/provenance changes.
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_IMMUTABLE';
  END IF;

  ever_approved := workout_catalog_revision_ever_approved(OLD);

  IF ever_approved OR OLD.status = 'APPROVED' THEN
    -- Only legal post-approval transition: APPROVED -> RETIRED with full freeze,
    -- and only when the revision is not pinned by the current PUBLISHED release.
    IF OLD.status = 'APPROVED'
       AND NEW.status = 'RETIRED'
       AND workout_catalog_revision_content_unchanged(OLD, NEW)
    THEN
      PERFORM workout_catalog_acquire_publish_lock();
      IF workout_catalog_revision_pinned_by_published(OLD.id) THEN
        RAISE EXCEPTION 'EXERCISE_REVISION_PUBLISHED_RELEASE_PINNED';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'EXERCISE_REVISION_IMMUTABLE';
  END IF;

  -- Pre-approval workflow.
  IF OLD.status = ANY (pre_approval) AND NEW.status = 'APPROVED' THEN
    IF NEW."approvedAt" IS NULL THEN
      NEW."approvedAt" := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'RETIRED' THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_STATUS_INVALID';
  END IF;

  IF NOT (OLD.status = ANY (pre_approval) AND NEW.status = ANY (pre_approval)) THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_STATUS_INVALID';
  END IF;

  IF OLD."approvedAt" IS NOT NULL
     AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_IMMUTABLE';
  END IF;
  IF NEW."approvedAt" IS NOT NULL AND OLD."approvedAt" IS NULL THEN
    RAISE EXCEPTION 'EXERCISE_REVISION_APPROVED_AT_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseRevision_immutable_upd" ON "ExerciseRevision";
CREATE TRIGGER "ExerciseRevision_immutable_upd"
  BEFORE UPDATE ON "ExerciseRevision"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_revision_immutable_guard();

DROP TRIGGER IF EXISTS "ExerciseRevision_immutable_del" ON "ExerciseRevision";
CREATE TRIGGER "ExerciseRevision_immutable_del"
  BEFORE DELETE ON "ExerciseRevision"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_revision_immutable_guard();

CREATE OR REPLACE FUNCTION workout_catalog_release_publish_items_valid(p_release_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item_count integer;
  bad_count integer;
  eligible_count integer;
BEGIN
  -- Serialize with eligibility mutations (re-entrant within same xact).
  PERFORM workout_catalog_acquire_publish_lock();

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (
      WHERE r.id IS NULL
         OR r.status IS DISTINCT FROM 'APPROVED'
         OR r."exerciseId" IS DISTINCT FROM i."exerciseId"
         OR e.id IS NULL
         OR e."familyId" IS DISTINCT FROM i."familyId"
         OR e."isActive" IS NOT TRUE
    )::integer
  INTO item_count, bad_count
  FROM "WorkoutCatalogReleaseItem" i
  LEFT JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
  LEFT JOIN "Exercise" e ON e.id = i."exerciseId"
  WHERE i."releaseId" = p_release_id;

  eligible_count := workout_catalog_release_eligible_item_count(p_release_id);

  IF item_count IS NULL OR item_count < 1 OR eligible_count IS NULL OR eligible_count < 1 THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_EMPTY';
  END IF;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_PUBLISH_INVALID';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION workout_catalog_release_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.status = 'RETIRED'
       AND NEW.code IS NOT DISTINCT FROM OLD.code
       AND NEW."manifestVersion" IS NOT DISTINCT FROM OLD."manifestVersion"
       AND NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt"
       AND NEW."createdBy" IS NOT DISTINCT FROM OLD."createdBy"
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
    THEN
      NEW."retiredAt" := COALESCE(NEW."retiredAt", now());
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_IMMUTABLE';
  END IF;

  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_IMMUTABLE';
  END IF;

  -- DRAFT → PUBLISHED: DB-level publish validation (blocks empty / non-eligible).
  IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN
    PERFORM workout_catalog_release_publish_items_valid(NEW.id);
    NEW."publishedAt" := COALESCE(NEW."publishedAt", OLD."publishedAt", now());
    NEW."retiredAt" := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'RETIRED' THEN
    NEW."retiredAt" := COALESCE(NEW."retiredAt", now());
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('DRAFT', 'PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_STATUS_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "WorkoutCatalogRelease_immutable_upd" ON "WorkoutCatalogRelease";
CREATE TRIGGER "WorkoutCatalogRelease_immutable_upd"
  BEFORE UPDATE ON "WorkoutCatalogRelease"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_release_immutable_guard();

DROP TRIGGER IF EXISTS "WorkoutCatalogRelease_immutable_del" ON "WorkoutCatalogRelease";
CREATE TRIGGER "WorkoutCatalogRelease_immutable_del"
  BEFORE DELETE ON "WorkoutCatalogRelease"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_release_immutable_guard();

-- Shared INSERT/UPDATE validation for release items.
CREATE OR REPLACE FUNCTION workout_catalog_release_item_mutate_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rel_status text;
  rev_status text;
  rev_exercise uuid;
  ex_family uuid;
  ex_active boolean;
BEGIN
  SELECT status INTO rel_status
  FROM "WorkoutCatalogRelease"
  WHERE id = COALESCE(NEW."releaseId", OLD."releaseId");

  IF rel_status IS NULL THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_NOT_FOUND';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF rel_status IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF rel_status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_IMMUTABLE';
  END IF;
  IF rel_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_IMMUTABLE';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."releaseId" IS DISTINCT FROM OLD."releaseId" THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_IMMUTABLE';
  END IF;

  SELECT status, "exerciseId" INTO rev_status, rev_exercise
  FROM "ExerciseRevision" WHERE id = NEW."exerciseRevisionId";
  IF rev_exercise IS NULL THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_REVISION_MISMATCH';
  END IF;
  IF rev_exercise IS DISTINCT FROM NEW."exerciseId" THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_REVISION_MISMATCH';
  END IF;
  -- Any item included in a release must pin an APPROVED revision.
  IF rev_status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_REQUIRES_APPROVED';
  END IF;
  IF NEW."enabledForGenerator" = true AND rev_status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_REQUIRES_APPROVED';
  END IF;

  SELECT "familyId", "isActive" INTO ex_family, ex_active
  FROM "Exercise" WHERE id = NEW."exerciseId";
  IF ex_family IS NULL OR ex_family IS DISTINCT FROM NEW."familyId" THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_FAMILY_MISMATCH';
  END IF;
  IF ex_active IS NOT TRUE THEN
    RAISE EXCEPTION 'WORKOUT_CATALOG_RELEASE_ITEM_EXERCISE_INACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "WorkoutCatalogReleaseItem_immutable_upd" ON "WorkoutCatalogReleaseItem";
DROP TRIGGER IF EXISTS "WorkoutCatalogReleaseItem_immutable_del" ON "WorkoutCatalogReleaseItem";
DROP TRIGGER IF EXISTS "WorkoutCatalogReleaseItem_insert_guard" ON "WorkoutCatalogReleaseItem";
DROP TRIGGER IF EXISTS "WorkoutCatalogReleaseItem_mutate_ins" ON "WorkoutCatalogReleaseItem";
DROP TRIGGER IF EXISTS "WorkoutCatalogReleaseItem_mutate_upd" ON "WorkoutCatalogReleaseItem";
DROP TRIGGER IF EXISTS "WorkoutCatalogReleaseItem_mutate_del" ON "WorkoutCatalogReleaseItem";

CREATE TRIGGER "WorkoutCatalogReleaseItem_mutate_ins"
  BEFORE INSERT ON "WorkoutCatalogReleaseItem"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_release_item_mutate_guard();
CREATE TRIGGER "WorkoutCatalogReleaseItem_mutate_upd"
  BEFORE UPDATE ON "WorkoutCatalogReleaseItem"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_release_item_mutate_guard();
CREATE TRIGGER "WorkoutCatalogReleaseItem_mutate_del"
  BEFORE DELETE ON "WorkoutCatalogReleaseItem"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_release_item_mutate_guard();

-- SafetyProfile: INSERT/UPDATE/DELETE blocked after ever-approved (OLD + NEW parents).
CREATE OR REPLACE FUNCTION workout_catalog_safety_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  locked boolean;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    locked := workout_catalog_revision_id_ever_approved(OLD."exerciseRevisionId");
    IF COALESCE(locked, false) THEN
      RAISE EXCEPTION 'EXERCISE_SAFETY_PROFILE_IMMUTABLE';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    locked := workout_catalog_revision_id_ever_approved(NEW."exerciseRevisionId");
    IF COALESCE(locked, false) THEN
      RAISE EXCEPTION 'EXERCISE_SAFETY_PROFILE_IMMUTABLE';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseSafetyProfile_immutable_ins" ON "ExerciseSafetyProfile";
DROP TRIGGER IF EXISTS "ExerciseSafetyProfile_immutable_upd" ON "ExerciseSafetyProfile";
DROP TRIGGER IF EXISTS "ExerciseSafetyProfile_immutable_del" ON "ExerciseSafetyProfile";
CREATE TRIGGER "ExerciseSafetyProfile_immutable_ins"
  BEFORE INSERT ON "ExerciseSafetyProfile"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_safety_immutable_guard();
CREATE TRIGGER "ExerciseSafetyProfile_immutable_upd"
  BEFORE UPDATE ON "ExerciseSafetyProfile"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_safety_immutable_guard();
CREATE TRIGGER "ExerciseSafetyProfile_immutable_del"
  BEFORE DELETE ON "ExerciseSafetyProfile"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_safety_immutable_guard();

-- Provenance / source references: permanent freeze under the same ever-approved marker.
CREATE OR REPLACE FUNCTION workout_catalog_source_reference_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  locked boolean;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    locked := workout_catalog_revision_id_ever_approved(OLD."exerciseRevisionId");
    IF COALESCE(locked, false) THEN
      RAISE EXCEPTION 'EXERCISE_SOURCE_REFERENCE_IMMUTABLE';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    locked := workout_catalog_revision_id_ever_approved(NEW."exerciseRevisionId");
    IF COALESCE(locked, false) THEN
      RAISE EXCEPTION 'EXERCISE_SOURCE_REFERENCE_IMMUTABLE';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExerciseSourceReference_immutable_ins" ON "ExerciseSourceReference";
DROP TRIGGER IF EXISTS "ExerciseSourceReference_immutable_upd" ON "ExerciseSourceReference";
DROP TRIGGER IF EXISTS "ExerciseSourceReference_immutable_del" ON "ExerciseSourceReference";
CREATE TRIGGER "ExerciseSourceReference_immutable_ins"
  BEFORE INSERT ON "ExerciseSourceReference"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_source_reference_immutable_guard();
CREATE TRIGGER "ExerciseSourceReference_immutable_upd"
  BEFORE UPDATE ON "ExerciseSourceReference"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_source_reference_immutable_guard();
CREATE TRIGGER "ExerciseSourceReference_immutable_del"
  BEFORE DELETE ON "ExerciseSourceReference"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_source_reference_immutable_guard();

-- Family/key freeze + block deactivating / key-mutating exercises that would
-- empty a live PUBLISHED generator selection (FIX 2/3).
-- Contract: Exercise.key is stable identity after first approval or release use.
CREATE OR REPLACE FUNCTION workout_catalog_exercise_identity_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ever_identity_locked boolean;
BEGIN
  IF NEW."familyId" IS DISTINCT FROM OLD."familyId"
     AND EXISTS (
       SELECT 1 FROM "WorkoutCatalogReleaseItem" i WHERE i."exerciseId" = OLD.id
     ) THEN
    RAISE EXCEPTION 'EXERCISE_FAMILY_IMMUTABLE';
  END IF;

  IF NEW."isActive" IS DISTINCT FROM OLD."isActive"
     AND NEW."isActive" IS NOT TRUE THEN
    PERFORM workout_catalog_acquire_publish_lock();
    IF workout_catalog_exercise_pinned_by_published_generator(OLD.id) THEN
      RAISE EXCEPTION 'EXERCISE_ACTIVE_PUBLISHED_RELEASE_PINNED';
    END IF;
  END IF;

  -- Key is stable after first approval/release membership. While pinned by the
  -- current PUBLISHED generator release, serialize with publish and raise the
  -- published-pin error so concurrent eligibility mutations cannot empty the live catalog.
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    ever_identity_locked := EXISTS (
      SELECT 1 FROM "WorkoutCatalogReleaseItem" i WHERE i."exerciseId" = OLD.id
    ) OR EXISTS (
      SELECT 1
      FROM "ExerciseRevision" r
      WHERE r."exerciseId" = OLD.id
        AND (
          r."approvedAt" IS NOT NULL
          OR r.status IN ('APPROVED', 'RETIRED')
        )
    );
    IF ever_identity_locked THEN
      PERFORM workout_catalog_acquire_publish_lock();
      IF workout_catalog_exercise_pinned_by_published_generator(OLD.id) THEN
        RAISE EXCEPTION 'EXERCISE_KEY_PUBLISHED_RELEASE_PINNED';
      END IF;
      RAISE EXCEPTION 'EXERCISE_KEY_IMMUTABLE';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Exercise_family_immutable_upd" ON "Exercise";
DROP TRIGGER IF EXISTS "Exercise_identity_immutable_upd" ON "Exercise";
CREATE TRIGGER "Exercise_identity_immutable_upd"
  BEFORE UPDATE ON "Exercise"
  FOR EACH ROW EXECUTE FUNCTION workout_catalog_exercise_identity_immutable_guard();

-- ---------------------------------------------------------------------------
-- J. Bootstrap: internal source + families + APPROVED revisions + release
-- ---------------------------------------------------------------------------
INSERT INTO "ExerciseCatalogSource" (id, code, "displayName", "sourceType", "baseUrl", active)
VALUES (
  'a2100001-0001-4000-8000-000000000001',
  'weight-app-internal',
  'Weight App internal owned content',
  'INTERNAL',
  NULL,
  true
)
ON CONFLICT (code) DO NOTHING;

-- Families used by existing seed (subset; full taxonomy lives in TS manifest).
INSERT INTO "ExerciseFamily" (slug, "nameRu", "nameEn", "movementPattern", "internalNote")
VALUES
  ('outdoor_walk', 'Ходьба', 'Outdoor walk', 'low_impact_conditioning', 'Bootstrap family'),
  ('bodyweight_squat', 'Приседания с весом тела', 'Bodyweight squat', 'squat', 'Bootstrap family'),
  ('gentle_stretch', 'Мягкая растяжка', 'Gentle stretch', 'mobility', 'Bootstrap family'),
  ('easy_jog', 'Лёгкий бег', 'Easy jog', 'low_impact_conditioning', 'Bootstrap family'),
  ('plank', 'Планка', 'Plank', 'anti_extension_core', 'Bootstrap family'),
  ('mobility_flow', 'Подвижность', 'Mobility flow', 'mobility', 'Bootstrap family'),
  ('push_up', 'Отжимания', 'Push-up', 'horizontal_push', 'Bootstrap family'),
  ('glute_bridge', 'Ягодичный мост', 'Glute bridge', 'hinge', 'Bootstrap family'),
  ('dead_bug', 'Жук', 'Dead bug', 'anti_extension_core', 'Bootstrap family'),
  ('band_row', 'Тяга эспандера', 'Band row', 'horizontal_pull', 'Bootstrap family'),
  ('band_pull_apart', 'Разведение эспандера', 'Band pull-apart', 'horizontal_pull', 'Bootstrap family'),
  ('dumbbell_row', 'Тяга гантели', 'Dumbbell row', 'horizontal_pull', 'Bootstrap family'),
  ('goblet_squat', 'Гоблет-присед', 'Goblet squat', 'squat', 'Bootstrap family'),
  ('leg_press', 'Жим ногами', 'Leg press', 'squat', 'Bootstrap family'),
  ('cable_row', 'Тяга блока', 'Cable row', 'horizontal_pull', 'Bootstrap family'),
  ('treadmill_walk', 'Ходьба на дорожке', 'Treadmill walk', 'low_impact_conditioning', 'Bootstrap family'),
  ('chest_press_machine', 'Жим от груди', 'Chest press machine', 'horizontal_push', 'Bootstrap family'),
  ('romanian_deadlift', 'Румынская тяга', 'Romanian deadlift', 'hinge', 'Bootstrap family'),
  ('lat_pulldown', 'Тяга верхнего блока', 'Lat pulldown', 'vertical_pull', 'Bootstrap family')
ON CONFLICT (slug) DO NOTHING;

-- Attach families to existing exercises by key.
UPDATE "Exercise" e
SET "familyId" = f.id
FROM "ExerciseFamily" f
WHERE e.key IS NOT NULL AND e."familyId" IS NULL AND (
  (e.key IN ('morning_walk','recovery_walk') AND f.slug = 'outdoor_walk')
  OR (e.key = 'bodyweight_squats' AND f.slug = 'bodyweight_squat')
  OR (e.key = 'stretching' AND f.slug = 'gentle_stretch')
  OR (e.key = 'light_jog' AND f.slug = 'easy_jog')
  OR (e.key = 'core_plank' AND f.slug = 'plank')
  OR (e.key = 'mobility_flow' AND f.slug = 'mobility_flow')
  OR (e.key = 'push_ups' AND f.slug = 'push_up')
  OR (e.key = 'glute_bridge' AND f.slug = 'glute_bridge')
  OR (e.key = 'dead_bug' AND f.slug = 'dead_bug')
  OR (e.key = 'band_row' AND f.slug = 'band_row')
  OR (e.key = 'band_pull_apart' AND f.slug = 'band_pull_apart')
  OR (e.key = 'dumbbell_row' AND f.slug = 'dumbbell_row')
  OR (e.key = 'goblet_squat' AND f.slug = 'goblet_squat')
  OR (e.key = 'machine_leg_press' AND f.slug = 'leg_press')
  OR (e.key = 'cable_row' AND f.slug = 'cable_row')
  OR (e.key = 'treadmill_walk' AND f.slug = 'treadmill_walk')
  OR (e.key = 'chest_press_machine' AND f.slug = 'chest_press_machine')
  OR (e.key = 'barbell_romanian_deadlift' AND f.slug = 'romanian_deadlift')
  OR (e.key = 'lat_pulldown' AND f.slug = 'lat_pulldown')
);

-- Revision 1 for each active seeded exercise (idempotent).
-- Insert as DRAFT first so safety/provenance can be attached before approval freeze.
INSERT INTO "ExerciseRevision" (
  "exerciseId", "revisionNumber", status,
  "nameRu", "nameEn",
  "techniqueRu", "techniqueEn",
  "commonMistakeRu", "commonMistakeEn",
  "defaultSets", "defaultRepsMin", "defaultRepsMax",
  "defaultDurationSeconds", "defaultRestSeconds", "estimatedDurationSeconds",
  "createdBy"
)
SELECT
  e.id,
  1,
  'DRAFT',
  COALESCE(e."nameRu", e.name),
  COALESCE(e."nameEn", e.name),
  e."techniqueSummaryRu",
  e."techniqueSummaryEn",
  e."commonMistakeRu",
  e."commonMistakeEn",
  2, 10, 12,
  CASE WHEN e."movementPattern" IN ('cardio','mobility') THEN COALESCE(e."estimatedMinutes", 5) * 60 ELSE NULL END,
  60,
  COALESCE(e."estimatedMinutes", 5) * 60,
  'system:workout-catalog-01a'
FROM "Exercise" e
WHERE e.key IS NOT NULL
  AND e."isActive" = true
  AND e.key IN (
    'morning_walk','bodyweight_squats','stretching','light_jog','core_plank','mobility_flow',
    'recovery_walk','push_ups','glute_bridge','dead_bug','band_row','band_pull_apart',
    'dumbbell_row','goblet_squat','machine_leg_press','cable_row','treadmill_walk',
    'chest_press_machine','barbell_romanian_deadlift','lat_pulldown'
  )
ON CONFLICT ("exerciseId", "revisionNumber") DO NOTHING;

-- Safety profiles for bootstrap revisions (pre-approval).
INSERT INTO "ExerciseSafetyProfile" (
  "exerciseRevisionId",
  "kneeLoad", "shoulderLoad", "spineLoad",
  "impactLevel", "balanceRequirement",
  "floorRequired", "overheadMovement", "deepKneeFlexion", "singleLeg",
  "beginnerAllowed", "requiresSpotter", "internalSafetyNote"
)
SELECT
  r.id,
  CASE
    WHEN e.key IN ('bodyweight_squats','goblet_squat','machine_leg_press') THEN 'MODERATE'
    ELSE 'LOW'
  END,
  CASE
    WHEN e.key IN ('push_ups','chest_press_machine','band_pull_apart','lat_pulldown') THEN 'MODERATE'
    ELSE 'LOW'
  END,
  CASE
    WHEN e.key IN ('barbell_romanian_deadlift','core_plank','dumbbell_row') THEN 'MODERATE'
    ELSE 'LOW'
  END,
  CASE WHEN e.key = 'light_jog' THEN 'MODERATE' ELSE 'LOW' END,
  'LOW',
  e.key IN ('core_plank','glute_bridge','dead_bug','push_ups','mobility_flow','stretching'),
  false,
  e.key IN ('bodyweight_squats','goblet_squat','machine_leg_press'),
  false,
  COALESCE(e.difficulty, 'BEGINNER') = 'BEGINNER',
  false,
  'Bootstrap safety profile from WORKOUT-CATALOG-01A'
FROM "ExerciseRevision" r
JOIN "Exercise" e ON e.id = r."exerciseId"
WHERE r."revisionNumber" = 1
  AND r.status = 'DRAFT'
ON CONFLICT ("exerciseRevisionId") DO NOTHING;

-- Provenance stub (internal owned content) before approval freeze.
INSERT INTO "ExerciseSourceReference" (
  "exerciseRevisionId", "sourceId", "externalReference", "factualNotes", "accessedAt"
)
SELECT
  r.id,
  s.id,
  e.key,
  'Transitional bootstrap from owned Exercise seed content',
  now()
FROM "ExerciseRevision" r
JOIN "Exercise" e ON e.id = r."exerciseId"
JOIN "ExerciseCatalogSource" s ON s.code = 'weight-app-internal'
WHERE r."revisionNumber" = 1
  AND r.status = 'DRAFT'
  AND NOT EXISTS (
    SELECT 1 FROM "ExerciseSourceReference" x
    WHERE x."exerciseRevisionId" = r.id AND x."sourceId" = s.id
  );

-- Promote bootstrap revisions to APPROVED (sets approvedAt via trigger).
UPDATE "ExerciseRevision" r
SET status = 'APPROVED',
    "reviewedAt" = COALESCE(r."reviewedAt", now())
WHERE r."revisionNumber" = 1
  AND r.status = 'DRAFT'
  AND r."createdBy" = 'system:workout-catalog-01a'
  AND EXISTS (
    SELECT 1 FROM "Exercise" e
    WHERE e.id = r."exerciseId"
      AND e.key IN (
        'morning_walk','bodyweight_squats','stretching','light_jog','core_plank','mobility_flow',
        'recovery_walk','push_ups','glute_bridge','dead_bug','band_row','band_pull_apart',
        'dumbbell_row','goblet_squat','machine_leg_press','cable_row','treadmill_walk',
        'chest_press_machine','barbell_romanian_deadlift','lat_pulldown'
      )
  );

-- EASIER edges from existing easierVariantKey.
INSERT INTO "ExerciseVariantRelation" (
  "fromExerciseId", "toExerciseId", "relationType", priority, "levelDelta", active
)
SELECT
  src.id,
  dst.id,
  'EASIER',
  100,
  -1,
  true
FROM "Exercise" src
JOIN "Exercise" dst ON dst.key = src."easierVariantKey"
WHERE src."easierVariantKey" IS NOT NULL
  AND src.id <> dst.id
ON CONFLICT ("fromExerciseId", "toExerciseId", "relationType", "equipmentContext", "placeContext") DO NOTHING;

-- Also HARDER reverse edges for unambiguous pairs (optional directional documentation).
INSERT INTO "ExerciseVariantRelation" (
  "fromExerciseId", "toExerciseId", "relationType", priority, "levelDelta", active
)
SELECT
  dst.id,
  src.id,
  'HARDER',
  100,
  1,
  true
FROM "Exercise" src
JOIN "Exercise" dst ON dst.key = src."easierVariantKey"
WHERE src."easierVariantKey" IS NOT NULL
  AND src.id <> dst.id
ON CONFLICT ("fromExerciseId", "toExerciseId", "relationType", "equipmentContext", "placeContext") DO NOTHING;

-- Bootstrap DRAFT release (fixed id), then items, then publish.
INSERT INTO "WorkoutCatalogRelease" (
  id, code, status, "manifestVersion", "createdBy", notes
)
VALUES (
  'a2100002-0001-4000-8000-000000000001',
  'workout-catalog-bootstrap-01a',
  'DRAFT',
  'workout-catalog-manifest-01a.1',
  'system:workout-catalog-01a',
  'Transitional APPROVED subset from legacy seed; not the full 84-entry target catalog'
)
ON CONFLICT (code) DO NOTHING;

-- Items only while release is DRAFT (insert guard). Idempotent via unique (release, exercise).
INSERT INTO "WorkoutCatalogReleaseItem" (
  "releaseId", "exerciseId", "exerciseRevisionId", "familyId", ordinal, "enabledForGenerator"
)
SELECT
  rel.id,
  e.id,
  r.id,
  e."familyId",
  m.ordinal,
  true
FROM "WorkoutCatalogRelease" rel
JOIN "Exercise" e ON e.key IS NOT NULL
JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r."revisionNumber" = 1 AND r.status = 'APPROVED'
JOIN (VALUES
  ('morning_walk', 1),
  ('bodyweight_squats', 2),
  ('stretching', 3),
  ('light_jog', 4),
  ('core_plank', 5),
  ('mobility_flow', 6),
  ('recovery_walk', 7),
  ('push_ups', 8),
  ('glute_bridge', 9),
  ('dead_bug', 10),
  ('band_row', 11),
  ('band_pull_apart', 12),
  ('dumbbell_row', 13),
  ('goblet_squat', 14),
  ('machine_leg_press', 15),
  ('cable_row', 16),
  ('treadmill_walk', 17),
  ('chest_press_machine', 18),
  ('barbell_romanian_deadlift', 19),
  ('lat_pulldown', 20)
) AS m(key, ordinal) ON m.key = e.key
WHERE rel.code = 'workout-catalog-bootstrap-01a'
  AND rel.status = 'DRAFT'
  AND e."familyId" IS NOT NULL
ON CONFLICT ("releaseId", "exerciseId") DO NOTHING;

-- Publish bootstrap release if still DRAFT and has items.
UPDATE "WorkoutCatalogRelease" rel
SET status = 'PUBLISHED',
    "publishedAt" = COALESCE(rel."publishedAt", now())
WHERE rel.code = 'workout-catalog-bootstrap-01a'
  AND rel.status = 'DRAFT'
  AND EXISTS (
    SELECT 1 FROM "WorkoutCatalogReleaseItem" i WHERE i."releaseId" = rel.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "WorkoutCatalogRelease" other
    WHERE other.status = 'PUBLISHED' AND other.id <> rel.id
  );
