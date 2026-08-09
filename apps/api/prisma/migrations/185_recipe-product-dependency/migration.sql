-- RP2-02B STEP_206: RecipeProductDependency + RecipeRevalidationTask.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "RecipeProductDependency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "productNutritionVersionId" uuid REFERENCES "ProductNutritionVersion"("id") ON DELETE SET NULL,
  "ingredientIndex" integer NOT NULL,
  "amount" numeric(12,3) NOT NULL,
  "unit" text NOT NULL,
  "dependencyRole" text NOT NULL DEFAULT 'INGREDIENT',
  "resolutionStatus" text NOT NULL DEFAULT 'RESOLVED',
  "source" text NOT NULL DEFAULT 'INGREDIENTS_SNAPSHOT',
  "nutritionCalories" numeric(12,3),
  "nutritionProteinG" numeric(12,3),
  "nutritionFatG" numeric(12,3),
  "nutritionCarbsG" numeric(12,3),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeProductDependency_ingredientIndex_check" CHECK ("ingredientIndex" >= 0),
  CONSTRAINT "RecipeProductDependency_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "RecipeProductDependency_role_check" CHECK ("dependencyRole" IN ('INGREDIENT')),
  CONSTRAINT "RecipeProductDependency_resolution_check" CHECK ("resolutionStatus" IN (
    'RESOLVED', 'LEGACY_UNRESOLVED', 'MISSING_PRODUCT', 'INVALID_UNIT'
  )),
  CONSTRAINT "RecipeProductDependency_version_ingredient_key" UNIQUE ("recipeVersionId", "ingredientIndex")
);

CREATE INDEX IF NOT EXISTS "RecipeProductDependency_productId_idx"
  ON "RecipeProductDependency" ("productId");
CREATE INDEX IF NOT EXISTS "RecipeProductDependency_recipeVersionId_idx"
  ON "RecipeProductDependency" ("recipeVersionId");
CREATE INDEX IF NOT EXISTS "RecipeProductDependency_nutritionVersion_idx"
  ON "RecipeProductDependency" ("productNutritionVersionId");

CREATE TABLE IF NOT EXISTS "RecipeRevalidationTask" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "productId" uuid NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "reasonCode" text NOT NULL,
  "severity" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "sourceEntityType" text,
  "sourceEntityId" text,
  "dedupeKey" text NOT NULL,
  "occurrenceCount" integer NOT NULL DEFAULT 1,
  "firstDetectedAt" timestamptz NOT NULL DEFAULT now(),
  "lastDetectedAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz,
  "resolvedBy" uuid,
  "resolutionCode" text,
  "resolutionNote" text,
  CONSTRAINT "RecipeRevalidationTask_severity_check" CHECK ("severity" IN ('WARNING', 'HIGH', 'CRITICAL')),
  CONSTRAINT "RecipeRevalidationTask_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  CONSTRAINT "RecipeRevalidationTask_reason_check" CHECK ("reasonCode" IN (
    'PRODUCT_NUTRITION_VERSION_CHANGED',
    'PRODUCT_ALLERGEN_CHANGED',
    'PRODUCT_DIETARY_TAG_CHANGED',
    'PRODUCT_MERGED',
    'PRODUCT_SUSPENDED',
    'PRODUCT_FORM_CHANGED',
    'PRODUCT_DEFAULT_UNIT_CHANGED',
    'PRODUCT_COEFFICIENT_CHANGED'
  )),
  CONSTRAINT "RecipeRevalidationTask_occurrence_check" CHECK ("occurrenceCount" > 0),
  CONSTRAINT "RecipeRevalidationTask_dedupe_key" UNIQUE ("dedupeKey")
);

CREATE INDEX IF NOT EXISTS "RecipeRevalidationTask_status_severity_idx"
  ON "RecipeRevalidationTask" ("status", "severity");
CREATE INDEX IF NOT EXISTS "RecipeRevalidationTask_productId_idx"
  ON "RecipeRevalidationTask" ("productId");
CREATE INDEX IF NOT EXISTS "RecipeRevalidationTask_recipeVersionId_idx"
  ON "RecipeRevalidationTask" ("recipeVersionId");
CREATE INDEX IF NOT EXISTS "RecipeRevalidationTask_reasonCode_idx"
  ON "RecipeRevalidationTask" ("reasonCode");
