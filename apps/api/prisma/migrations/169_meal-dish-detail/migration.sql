-- STEP_092: meal/dish detail — recipe steps, meal schedule, product macros.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "fatPer100g" numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "carbsPer100g" numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "packageSize" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "packageUnit" text;

ALTER TABLE "Recipe"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "prepMinutes" integer,
  ADD COLUMN IF NOT EXISTS "cookMinutes" integer,
  ADD COLUMN IF NOT EXISTS "difficulty" text,
  ADD COLUMN IF NOT EXISTS "portionGrams" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "allergens" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "dietaryTags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "equipment" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "recipeKey" text;

CREATE UNIQUE INDEX IF NOT EXISTS "Recipe_recipeKey_key" ON "Recipe" ("recipeKey");

CREATE TABLE IF NOT EXISTS "RecipeStep" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeId" uuid NOT NULL REFERENCES "Recipe"("id") ON DELETE CASCADE,
  "stepIndex" integer NOT NULL,
  "instruction" text NOT NULL,
  "durationMinutes" integer,
  "temperatureC" integer,
  "equipment" text,
  UNIQUE ("recipeId", "stepIndex")
);

CREATE INDEX IF NOT EXISTS "RecipeStep_recipeId_idx" ON "RecipeStep" ("recipeId");

ALTER TABLE "Meal"
  ADD COLUMN IF NOT EXISTS "mealType" text,
  ADD COLUMN IF NOT EXISTS "plannedTime" text;

ALTER TABLE "MealItem"
  ADD COLUMN IF NOT EXISTS "portionGrams" numeric(10,2);

-- Fixture region/store for STEP_092 price observations (idempotent).
INSERT INTO "Region" ("id", "code")
VALUES ('c0920000-0000-4000-8000-000000000001', 'STEP092')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Retailer" ("id", "name", "key", "type", "code", "region", "active")
VALUES (
  'c0920000-0000-4000-8000-000000000002',
  'STEP092 Fixture Store',
  'step092_fixture',
  'CHAIN',
  'STEP092',
  'RU',
  true
)
ON CONFLICT ("key") DO UPDATE SET "code" = EXCLUDED."code", "active" = true;

INSERT INTO "RetailStore" ("id", "retailerId", "regionId", "name")
SELECT
  'c0920000-0000-4000-8000-000000000003',
  r.id,
  rg.id,
  'STEP092 Local'
FROM "Retailer" r
CROSS JOIN "Region" rg
WHERE r."key" = 'step092_fixture' AND rg.code = 'STEP092'
ON CONFLICT ("id") DO NOTHING;
