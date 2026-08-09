-- RP2-02A STEP_202: RecipeFamily + optional Recipe.recipeFamilyId linkage.
-- Does not modify migrations 001–179.

CREATE TABLE IF NOT EXISTS "RecipeFamily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "canonicalName" text NOT NULL,
  "slug" text NOT NULL,
  "dishType" text NOT NULL DEFAULT 'UNCLASSIFIED',
  "primaryProductId" uuid REFERENCES "Product"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RecipeFamily_slug_key" UNIQUE ("slug"),
  CONSTRAINT "RecipeFamily_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT "RecipeFamily_canonicalName_nonempty" CHECK (BTRIM("canonicalName") <> ''),
  CONSTRAINT "RecipeFamily_slug_nonempty" CHECK (BTRIM("slug") <> '')
);

CREATE INDEX IF NOT EXISTS "RecipeFamily_status_idx" ON "RecipeFamily" ("status");
CREATE INDEX IF NOT EXISTS "RecipeFamily_primaryProductId_idx" ON "RecipeFamily" ("primaryProductId");

ALTER TABLE "Recipe"
  ADD COLUMN IF NOT EXISTS "recipeFamilyId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Recipe_recipeFamilyId_fkey'
  ) THEN
    ALTER TABLE "Recipe"
      ADD CONSTRAINT "Recipe_recipeFamilyId_fkey"
      FOREIGN KEY ("recipeFamilyId") REFERENCES "RecipeFamily"("id") ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Recipe_recipeFamilyId_idx" ON "Recipe" ("recipeFamilyId");

-- Prevent physical delete of RecipeFamily while Recipes reference it (RESTRICT already);
-- also block delete when any Recipe still points at the family via trigger for clearer error.
CREATE OR REPLACE FUNCTION recipe_family_deny_delete_if_used()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Recipe" r WHERE r."recipeFamilyId" = OLD.id) THEN
    RAISE EXCEPTION 'RECIPE_FAMILY_IN_USE';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS recipe_family_deny_delete_if_used_trg ON "RecipeFamily";
CREATE TRIGGER recipe_family_deny_delete_if_used_trg
  BEFORE DELETE ON "RecipeFamily"
  FOR EACH ROW EXECUTE FUNCTION recipe_family_deny_delete_if_used();
