-- RP2-02A: immutability for published/backfilled RecipeVersion rows.

CREATE OR REPLACE FUNCTION recipe_version_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."publishedAt" IS NOT NULL OR OLD."status" IN ('PUBLISHED', 'LEGACY_BACKFILL', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'RECIPE_VERSION_IMMUTABLE';
    END IF;
    IF EXISTS (SELECT 1 FROM "MealItem" mi WHERE mi."recipeVersionId" = OLD.id) THEN
      RAISE EXCEPTION 'RECIPE_VERSION_REFERENCED_BY_MEAL_ITEM';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD."publishedAt" IS NOT NULL OR OLD."status" IN ('PUBLISHED', 'LEGACY_BACKFILL', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'RECIPE_VERSION_IMMUTABLE';
  END IF;
  -- DRAFT may update except recipeId / versionNumber / checksum identity rules
  IF NEW."recipeId" IS DISTINCT FROM OLD."recipeId" THEN
    RAISE EXCEPTION 'RECIPE_VERSION_RECIPE_ID_IMMUTABLE';
  END IF;
  IF NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber" THEN
    RAISE EXCEPTION 'RECIPE_VERSION_NUMBER_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipe_version_no_update ON "RecipeVersion";
CREATE TRIGGER recipe_version_no_update
  BEFORE UPDATE ON "RecipeVersion"
  FOR EACH ROW EXECUTE FUNCTION recipe_version_immutable_guard();

DROP TRIGGER IF EXISTS recipe_version_no_delete ON "RecipeVersion";
CREATE TRIGGER recipe_version_no_delete
  BEFORE DELETE ON "RecipeVersion"
  FOR EACH ROW EXECUTE FUNCTION recipe_version_immutable_guard();
