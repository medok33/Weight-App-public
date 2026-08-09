-- RP2-03A STEP_209: RecipeCoverageSlot

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeCoverageSlot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slotKey" text NOT NULL,
  "matrixVersion" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "mealType" text NOT NULL,
  "primaryProductId" uuid REFERENCES "Product"("id") ON DELETE RESTRICT,
  "dishType" text NOT NULL,
  "cookingMethod" text,
  "calorieMin" integer,
  "calorieMax" integer,
  "proteinMin" numeric(8,2),
  "fatMax" numeric(8,2),
  "maximumTimeMinutes" integer,
  "maximumCost" numeric(12,2),
  "currency" text,
  "dietaryProfile" text NOT NULL,
  "equipmentProfile" text NOT NULL,
  "desiredRecipeCount" integer NOT NULL,
  "publishedRecipeCount" integer NOT NULL DEFAULT 0,
  "priority" text NOT NULL,
  "sortRank" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'EMPTY',
  "provenance" text NOT NULL,
  "rationale" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "lastAnalyzedAt" timestamptz,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeCoverageSlot_desired_check" CHECK ("desiredRecipeCount" >= 1),
  CONSTRAINT "RecipeCoverageSlot_published_check" CHECK ("publishedRecipeCount" >= 0),
  CONSTRAINT "RecipeCoverageSlot_calorie_check" CHECK (
    "calorieMin" IS NULL OR "calorieMax" IS NULL OR "calorieMin" <= "calorieMax"
  ),
  CONSTRAINT "RecipeCoverageSlot_priority_check" CHECK ("priority" IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  CONSTRAINT "RecipeCoverageSlot_status_check" CHECK ("status" IN (
    'EMPTY','UNDERFILLED','COVERED','OVERFILLED','NEEDS_REFRESH'
  )),
  CONSTRAINT "RecipeCoverageSlot_matrix_slot_key" UNIQUE ("matrixVersion", "slotKey")
);

CREATE INDEX IF NOT EXISTS "RecipeCoverageSlot_matrix_status_idx"
  ON "RecipeCoverageSlot" ("matrixVersion", "status") WHERE "active" = true;
CREATE INDEX IF NOT EXISTS "RecipeCoverageSlot_meal_priority_idx"
  ON "RecipeCoverageSlot" ("mealType", "priority");
CREATE INDEX IF NOT EXISTS "RecipeCoverageSlot_primaryProduct_idx"
  ON "RecipeCoverageSlot" ("primaryProductId");
