-- RP2-02A STEP_203: RecipeVersion immutable snapshots + Recipe currentVersionId.
-- Semantics (model B): currentVersionId = current published/usable version;
-- draft content lives in mutable Recipe / RecipeIngredient / RecipeStep workspace.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeVersion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeId" uuid NOT NULL REFERENCES "Recipe"("id") ON DELETE RESTRICT,
  "versionNumber" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'PUBLISHED',
  "contentSnapshotJson" jsonb NOT NULL,
  "ingredientsSnapshotJson" jsonb NOT NULL,
  "stepsSnapshotJson" jsonb NOT NULL,
  "nutritionSnapshotJson" jsonb NOT NULL,
  "costSnapshotJson" jsonb,
  "restrictionSnapshotJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "servings" integer NOT NULL DEFAULT 1,
  "servingWeightGrams" numeric(10,2),
  "changeType" text NOT NULL,
  "changeReason" text,
  "createdBy" uuid,
  "approvedBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "approvedAt" timestamptz,
  "publishedAt" timestamptz,
  "checksum" text NOT NULL,
  "parentVersionId" uuid REFERENCES "RecipeVersion"("id") ON DELETE SET NULL,
  "provenance" text NOT NULL DEFAULT 'SYSTEM',
  CONSTRAINT "RecipeVersion_recipeId_versionNumber_key" UNIQUE ("recipeId", "versionNumber"),
  CONSTRAINT "RecipeVersion_versionNumber_check" CHECK ("versionNumber" > 0),
  CONSTRAINT "RecipeVersion_servings_check" CHECK ("servings" > 0),
  CONSTRAINT "RecipeVersion_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'LEGACY_BACKFILL')),
  CONSTRAINT "RecipeVersion_changeType_check" CHECK ("changeType" IN (
    'LEGACY_BACKFILL', 'MANUAL_PUBLISH', 'CONTENT_UPDATE', 'SYSTEM', 'FIXTURE'
  )),
  CONSTRAINT "RecipeVersion_provenance_check" CHECK ("provenance" IN (
    'SYSTEM', 'LEGACY_BACKFILL', 'OWNER_PUBLISH', 'ADMIN_PUBLISH', 'FIXTURE'
  )),
  CONSTRAINT "RecipeVersion_checksum_nonempty" CHECK (BTRIM("checksum") <> '')
);

CREATE INDEX IF NOT EXISTS "RecipeVersion_recipeId_idx" ON "RecipeVersion" ("recipeId");
CREATE INDEX IF NOT EXISTS "RecipeVersion_publishedAt_idx" ON "RecipeVersion" ("publishedAt" DESC);
CREATE INDEX IF NOT EXISTS "RecipeVersion_status_idx" ON "RecipeVersion" ("status");

ALTER TABLE "Recipe"
  ADD COLUMN IF NOT EXISTS "currentVersionId" uuid,
  ADD COLUMN IF NOT EXISTS "contentRevision" integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Recipe_currentVersionId_fkey'
  ) THEN
    ALTER TABLE "Recipe"
      ADD CONSTRAINT "Recipe_currentVersionId_fkey"
      FOREIGN KEY ("currentVersionId") REFERENCES "RecipeVersion"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Recipe_currentVersionId_idx" ON "Recipe" ("currentVersionId");

-- Initial v1 backfill from mutable Recipe workspace (idempotent).
WITH ordered_ing AS (
  SELECT
    ri."recipeId",
    ri."productId",
    ri.quantity,
    ri.unit,
    COALESCE(p."canonicalName", p.name, ri."productId"::text) AS display_name,
    COALESCE(p."caloriesPer100g", 0) AS cal,
    COALESCE(p."proteinPer100g", 0) AS protein,
    COALESCE(p."fatPer100g", 0) AS fat,
    COALESCE(p."carbsPer100g", 0) AS carbs,
    ROW_NUMBER() OVER (PARTITION BY ri."recipeId" ORDER BY ri.id) AS ordering
  FROM "RecipeIngredient" ri
  LEFT JOIN "Product" p ON p.id = ri."productId"
),
ing AS (
  SELECT
    oi."recipeId",
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'productId', oi."productId",
          'canonicalProductId', oi."productId",
          'displayName', oi.display_name,
          'amount', oi.quantity,
          'unit', oi.unit,
          'ordering', oi.ordering
        )
        ORDER BY oi.ordering
      ),
      '[]'::jsonb
    ) AS ingredients_json,
    jsonb_build_object(
      'calories', ROUND(SUM(
        oi.cal * (CASE WHEN oi.unit IN ('g','ml') THEN oi.quantity ELSE 0 END) / 100.0
      )::numeric, 2),
      'proteinG', ROUND(SUM(
        oi.protein * (CASE WHEN oi.unit IN ('g','ml') THEN oi.quantity ELSE 0 END) / 100.0
      )::numeric, 2),
      'fatG', ROUND(SUM(
        oi.fat * (CASE WHEN oi.unit IN ('g','ml') THEN oi.quantity ELSE 0 END) / 100.0
      )::numeric, 2),
      'carbsG', ROUND(SUM(
        oi.carbs * (CASE WHEN oi.unit IN ('g','ml') THEN oi.quantity ELSE 0 END) / 100.0
      )::numeric, 2),
      'basis', 'per_recipe_servings',
      'source', 'LEGACY_BACKFILL_PRODUCT_MACROS'
    ) AS nutrition_json
  FROM ordered_ing oi
  GROUP BY oi."recipeId"
),
steps AS (
  SELECT
    rs."recipeId",
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'stepIndex', rs."stepIndex",
          'instruction', rs.instruction,
          'durationMinutes', rs."durationMinutes",
          'temperatureC', rs."temperatureC",
          'equipment', rs.equipment
        )
        ORDER BY rs."stepIndex"
      ),
      '[]'::jsonb
    ) AS steps_json
  FROM "RecipeStep" rs
  GROUP BY rs."recipeId"
),
built AS (
  SELECT
    r.id AS recipe_id,
    r.servings,
    r."portionGrams",
    jsonb_build_object(
      'title', r.name,
      'description', r.description,
      'servings', r.servings,
      'prepMinutes', r."prepMinutes",
      'cookMinutes', r."cookMinutes",
      'difficulty', r.difficulty,
      'portionGrams', r."portionGrams",
      'equipment', COALESCE(r.equipment, '[]'::jsonb),
      'recipeKey', r."recipeKey",
      'allergens', COALESCE(r.allergens, '[]'::jsonb),
      'dietaryTags', COALESCE(r."dietaryTags", '[]'::jsonb)
    ) AS content_json,
    COALESCE(ing.ingredients_json, '[]'::jsonb) AS ingredients_json,
    COALESCE(steps.steps_json, '[]'::jsonb) AS steps_json,
    COALESCE(ing.nutrition_json, jsonb_build_object(
      'calories', 0, 'proteinG', 0, 'fatG', 0, 'carbsG', 0,
      'basis', 'per_recipe_servings', 'source', 'LEGACY_BACKFILL_EMPTY'
    )) AS nutrition_json,
    jsonb_build_object(
      'allergens', COALESCE(r.allergens, '[]'::jsonb),
      'dietaryTags', COALESCE(r."dietaryTags", '[]'::jsonb)
    ) AS restriction_json,
    encode(
      digest(
        COALESCE(r.name, '') || '|' ||
        COALESCE(r.description, '') || '|' ||
        COALESCE(ing.ingredients_json::text, '[]') || '|' ||
        COALESCE(steps.steps_json::text, '[]'),
        'sha256'
      ),
      'hex'
    ) AS checksum
  FROM "Recipe" r
  LEFT JOIN ing ON ing."recipeId" = r.id
  LEFT JOIN steps ON steps."recipeId" = r.id
  WHERE NOT EXISTS (
    SELECT 1 FROM "RecipeVersion" v WHERE v."recipeId" = r.id AND v."versionNumber" = 1
  )
)
INSERT INTO "RecipeVersion" (
  "recipeId",
  "versionNumber",
  "status",
  "contentSnapshotJson",
  "ingredientsSnapshotJson",
  "stepsSnapshotJson",
  "nutritionSnapshotJson",
  "costSnapshotJson",
  "restrictionSnapshotJson",
  "servings",
  "servingWeightGrams",
  "changeType",
  "changeReason",
  "publishedAt",
  "checksum",
  "provenance"
)
SELECT
  b.recipe_id,
  1,
  'LEGACY_BACKFILL',
  b.content_json,
  b.ingredients_json,
  b.steps_json,
  b.nutrition_json,
  NULL,
  b.restriction_json,
  GREATEST(COALESCE(b.servings, 1), 1),
  b."portionGrams",
  'LEGACY_BACKFILL',
  'RP2-02A initial snapshot from mutable Recipe',
  now(),
  b.checksum,
  'LEGACY_BACKFILL'
FROM built b;

UPDATE "Recipe" r
SET "currentVersionId" = v.id
FROM "RecipeVersion" v
WHERE v."recipeId" = r.id
  AND v."versionNumber" = (
    SELECT MAX(v2."versionNumber") FROM "RecipeVersion" v2 WHERE v2."recipeId" = r.id
  )
  AND (r."currentVersionId" IS NULL OR r."currentVersionId" IS DISTINCT FROM v.id);
