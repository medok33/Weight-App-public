ALTER TABLE "RecipeSynthesisBrief"
  ADD COLUMN IF NOT EXISTS "deterministicSelections" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "ownerDecisions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "exclusions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "servings" integer,
  ADD COLUMN IF NOT EXISTS "totalTimeMinutes" integer;
