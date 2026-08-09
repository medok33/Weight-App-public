-- RP2-02B backfill: lifecycle rows + RecipeProductDependency from snapshots.
-- Does NOT mutate RecipeVersion checksum/content snapshots.
-- ProductNutritionVersion is left NULL for legacy rows (LEGACY_UNRESOLVED) —
-- never bind to a random current nutrition version without proof.

INSERT INTO "RecipeVersionLifecycle" (
  "recipeVersionId", "lifecycleStatus", "validationStatus", "revision",
  "changedAt", "reasonCode", "reasonText"
)
SELECT
  v.id,
  CASE
    WHEN r."currentVersionId" = v.id THEN 'PUBLISHED'
    WHEN v."publishedAt" IS NOT NULL OR v.status IN ('PUBLISHED', 'LEGACY_BACKFILL', 'SUPERSEDED')
      THEN 'SUPERSEDED'
    WHEN v.status = 'DRAFT' THEN 'IN_REVIEW'
    ELSE 'IN_REVIEW'
  END,
  'VALID',
  1,
  COALESCE(v."publishedAt", v."createdAt", now()),
  'LIFECYCLE_BACKFILL',
  'RP2-02B deterministic lifecycle backfill'
FROM "RecipeVersion" v
LEFT JOIN "Recipe" r ON r.id = v."recipeId"
ON CONFLICT ("recipeVersionId") DO NOTHING;

INSERT INTO "RecipeProductDependency" (
  "recipeVersionId", "productId", "productNutritionVersionId",
  "ingredientIndex", "amount", "unit", "dependencyRole",
  "resolutionStatus", "source",
  "nutritionCalories", "nutritionProteinG", "nutritionFatG", "nutritionCarbsG"
)
SELECT
  v.id,
  p.id,
  NULL,
  (ord.ord - 1)::int,
  GREATEST(COALESCE((ing->>'amount')::numeric, 0), 0.001),
  COALESCE(NULLIF(ing->>'unit', ''), 'g'),
  'INGREDIENT',
  'LEGACY_UNRESOLVED',
  'INGREDIENTS_SNAPSHOT_BACKFILL',
  NULLIF(ing->>'calories', '')::numeric,
  NULLIF(ing->>'proteinG', '')::numeric,
  NULLIF(ing->>'fatG', '')::numeric,
  NULLIF(ing->>'carbsG', '')::numeric
FROM "RecipeVersion" v
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v."ingredientsSnapshotJson", '[]'::jsonb))
  WITH ORDINALITY AS ord(ing, ord)
INNER JOIN "Product" p ON p.id = COALESCE(
  NULLIF(ing->>'canonicalProductId', '')::uuid,
  NULLIF(ing->>'productId', '')::uuid
)
WHERE COALESCE((ing->>'amount')::numeric, 0) > 0
ON CONFLICT ("recipeVersionId", "ingredientIndex") DO NOTHING;
