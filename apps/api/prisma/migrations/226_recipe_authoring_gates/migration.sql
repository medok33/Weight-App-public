-- STEP-329..338: persistent human gates and authoring audit. No AI or source adapter writes canonical recipes.
CREATE TABLE IF NOT EXISTS "RecipeEditorialReview" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "reviewerId" uuid NOT NULL,
  "reviewedAt" timestamptz NOT NULL,
  "decision" text NOT NULL CHECK ("decision" IN ('NOT_REVIEWED','PASS','FAIL','NEEDS_CHANGES')),
  "notes" text,
  "defectsJson" jsonb NOT NULL DEFAULT '[]',
  "correctionsJson" jsonb NOT NULL DEFAULT '[]',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "RecipeEditorialReview_version_idx" ON "RecipeEditorialReview" ("recipeVersionId", "reviewedAt");
CREATE TABLE IF NOT EXISTS "RecipeCookTest" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipeVersionId" uuid NOT NULL REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT,
  "reviewerId" uuid NOT NULL,
  "testedAt" timestamptz NOT NULL,
  "actuallyCooked" boolean NOT NULL,
  "actualCookingTimeMinutes" integer NOT NULL CHECK ("actualCookingTimeMinutes" >= 0),
  "actualYieldGrams" numeric(10,2) NOT NULL CHECK ("actualYieldGrams" > 0),
  "ingredientMeasurability" boolean NOT NULL,
  "stepExecutability" boolean NOT NULL,
  "equipmentSufficiency" boolean NOT NULL,
  "textureResult" text NOT NULL,
  "tasteResult" text NOT NULL,
  "defectsJson" jsonb NOT NULL DEFAULT '[]',
  "notes" text,
  "decision" text NOT NULL CHECK ("decision" IN ('PASS','FAIL')),
  CONSTRAINT "RecipeCookTest_pass_requires_cooked" CHECK ("decision" <> 'PASS' OR "actuallyCooked" = true),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "RecipeCookTest_version_idx" ON "RecipeCookTest" ("recipeVersionId", "testedAt");
