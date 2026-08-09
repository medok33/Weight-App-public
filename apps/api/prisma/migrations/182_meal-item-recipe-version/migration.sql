-- RP2-02A STEP_204: MealItem.recipeVersionId pinning + optional customization snapshot.
-- servingMultiplier reuses existing MealItem.servings (no duplicate column).

ALTER TABLE "MealItem"
  ADD COLUMN IF NOT EXISTS "recipeVersionId" uuid,
  ADD COLUMN IF NOT EXISTS "customizationSnapshotJson" jsonb,
  ADD COLUMN IF NOT EXISTS "contentProvenance" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MealItem_recipeVersionId_fkey'
  ) THEN
    ALTER TABLE "MealItem"
      ADD CONSTRAINT "MealItem_recipeVersionId_fkey"
      FOREIGN KEY ("recipeVersionId") REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MealItem_recipeVersionId_idx" ON "MealItem" ("recipeVersionId");

-- Soft FK was recipeId without constraint; add optional FK only where recipe exists.
-- Keep recipeId nullable for legacy rows without recipe; enforce match when version set.
CREATE OR REPLACE FUNCTION meal_item_recipe_version_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_recipe_id uuid;
BEGIN
  IF NEW."recipeVersionId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT v."recipeId" INTO version_recipe_id
  FROM "RecipeVersion" v
  WHERE v.id = NEW."recipeVersionId";
  IF version_recipe_id IS NULL THEN
    RAISE EXCEPTION 'MEAL_ITEM_RECIPE_VERSION_NOT_FOUND';
  END IF;
  IF NEW."recipeId" IS NULL THEN
    NEW."recipeId" := version_recipe_id;
  ELSIF NEW."recipeId" IS DISTINCT FROM version_recipe_id THEN
    RAISE EXCEPTION 'MEAL_ITEM_RECIPE_VERSION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meal_item_recipe_version_match_trg ON "MealItem";
CREATE TRIGGER meal_item_recipe_version_match_trg
  BEFORE INSERT OR UPDATE OF "recipeId", "recipeVersionId" ON "MealItem"
  FOR EACH ROW EXECUTE FUNCTION meal_item_recipe_version_match();

-- Backfill: pin MealItem to Recipe.currentVersionId when soft recipeId resolves.
UPDATE "MealItem" mi
SET
  "recipeVersionId" = r."currentVersionId",
  "contentProvenance" = COALESCE(mi."contentProvenance", 'LEGACY_BACKFILL')
FROM "Recipe" r
WHERE mi."recipeId" = r.id
  AND mi."recipeVersionId" IS NULL
  AND r."currentVersionId" IS NOT NULL;

-- Unresolved soft recipeIds (no matching Recipe) stay NULL with explicit provenance.
UPDATE "MealItem" mi
SET "contentProvenance" = 'LEGACY_RECIPE_CURRENT'
WHERE mi."recipeVersionId" IS NULL
  AND mi."recipeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Recipe" r WHERE r.id = mi."recipeId")
  AND (mi."contentProvenance" IS NULL OR mi."contentProvenance" = '');

UPDATE "MealItem" mi
SET "contentProvenance" = COALESCE(mi."contentProvenance", 'LEGACY_RECIPE_CURRENT')
WHERE mi."recipeVersionId" IS NULL
  AND mi."recipeId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Recipe" r WHERE r.id = mi."recipeId" AND r."currentVersionId" IS NULL);
