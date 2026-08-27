DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "RecipeVersion" GROUP BY checksum HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'RecipeVersion checksum duplicates prevent safe uniqueness migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "RecipeVersion_checksum_key" ON "RecipeVersion" (checksum);
