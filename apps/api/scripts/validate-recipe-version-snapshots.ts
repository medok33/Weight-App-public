/**
 * Read-only RecipeVersion v1 snapshot validation (RP2-02A).
 * Never UPDATEs published versions. Emits docs/recipe-platform/RP2_02A_SNAPSHOT_VALIDATION_REPORT.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import {
  canonicalizeAllergenToken,
  canonicalizeDietaryToken,
  resolveDishDietaryTags,
} from '../src/modules/meal-plan/domain/dish-restrictions.policy';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

type Issue = {
  recipeVersionId: string;
  recipeId: string;
  versionNumber: number;
  code: string;
  detail: string;
};

async function main() {
  const pool = new Pool({ connectionString });
  const issues: Issue[] = [];
  const stats = {
    versionsScanned: 0,
    publishedV1: 0,
    withIssues: 0,
  };

  try {
    const rows = await pool.query<{
      id: string;
      recipeId: string;
      versionNumber: number;
      status: string;
      servingWeightGrams: string | null;
      servings: string;
      ingredientsSnapshotJson: unknown;
      nutritionSnapshotJson: unknown;
      restrictionSnapshotJson: unknown;
      contentSnapshotJson: unknown;
    }>(
      `SELECT id, "recipeId", "versionNumber", status,
              "servingWeightGrams"::text AS "servingWeightGrams",
              servings::text AS servings,
              "ingredientsSnapshotJson",
              "nutritionSnapshotJson",
              "restrictionSnapshotJson",
              "contentSnapshotJson"
       FROM "RecipeVersion"
       WHERE "versionNumber" = 1
       ORDER BY "createdAt"`,
    );

    for (const row of rows.rows) {
      stats.versionsScanned += 1;
      if (row.status === 'PUBLISHED') stats.publishedV1 += 1;
      const before = issues.length;

      const ingredients = Array.isArray(row.ingredientsSnapshotJson)
        ? (row.ingredientsSnapshotJson as Array<Record<string, unknown>>)
        : [];
      const nutrition = (row.nutritionSnapshotJson ?? {}) as Record<string, unknown>;
      const restrictions = (row.restrictionSnapshotJson ?? {}) as {
        allergens?: unknown[];
        dietaryTags?: unknown[];
      };

      if (!(Number(row.servings) > 0)) {
        issues.push({
          recipeVersionId: row.id,
          recipeId: row.recipeId,
          versionNumber: row.versionNumber,
          code: 'INVALID_SERVINGS',
          detail: `servings=${row.servings}`,
        });
      }
      if (row.servingWeightGrams != null && !(Number(row.servingWeightGrams) > 0)) {
        issues.push({
          recipeVersionId: row.id,
          recipeId: row.recipeId,
          versionNumber: row.versionNumber,
          code: 'INVALID_PORTION',
          detail: `servingWeightGrams=${row.servingWeightGrams}`,
        });
      }

      const productIds = new Set<string>();
      for (const ing of ingredients) {
        const productId = String(ing.canonicalProductId ?? ing.productId ?? '');
        if (!productId || !/^[0-9a-f-]{36}$/i.test(productId)) {
          issues.push({
            recipeVersionId: row.id,
            recipeId: row.recipeId,
            versionNumber: row.versionNumber,
            code: 'MISSING_CANONICAL_PRODUCT_ID',
            detail: JSON.stringify(ing).slice(0, 200),
          });
        } else {
          productIds.add(productId);
        }
        const amount = Number(ing.amount);
        if (!(amount > 0)) {
          issues.push({
            recipeVersionId: row.id,
            recipeId: row.recipeId,
            versionNumber: row.versionNumber,
            code: 'INVALID_INGREDIENT_AMOUNT',
            detail: String(ing.displayName ?? productId),
          });
        }
        const label = String(ing.displayName ?? '');
        if (/^[0-9a-f-]{36}$/i.test(label) || /HEURISTIC_|GLUTEN_FREE|VEGAN/.test(label)) {
          issues.push({
            recipeVersionId: row.id,
            recipeId: row.recipeId,
            versionNumber: row.versionNumber,
            code: 'RAW_INTERNAL_LABEL',
            detail: label,
          });
        }
      }

      const allergenTokens = (restrictions.allergens ?? []).map(String);
      const seenAllergen = new Set<string>();
      for (const token of allergenTokens) {
        const code = canonicalizeAllergenToken(token) ?? token.toUpperCase();
        if (seenAllergen.has(code)) {
          issues.push({
            recipeVersionId: row.id,
            recipeId: row.recipeId,
            versionNumber: row.versionNumber,
            code: 'DUPLICATE_ALLERGEN_TOKEN',
            detail: `${token}→${code}`,
          });
        }
        seenAllergen.add(code);
      }

      const dietaryTokens = (restrictions.dietaryTags ?? []).map(String);
      const seenDietary = new Set<string>();
      const claimed: string[] = [];
      for (const token of dietaryTokens) {
        const code = canonicalizeDietaryToken(token) ?? token.toUpperCase();
        if (seenDietary.has(code)) {
          issues.push({
            recipeVersionId: row.id,
            recipeId: row.recipeId,
            versionNumber: row.versionNumber,
            code: 'DUPLICATE_DIETARY_TOKEN',
            detail: `${token}→${code}`,
          });
        }
        seenDietary.add(code);
        claimed.push(token);
      }

      const dietary = resolveDishDietaryTags({
        claimedTags: claimed,
        ingredientNames: ingredients.map((ing) => String(ing.displayName ?? '')),
        allergenCodes: [...seenAllergen].filter((c) =>
          ['PEANUT', 'MILK', 'EGG', 'FISH', 'SHELLFISH', 'SOY', 'GLUTEN', 'SESAME'].includes(c),
        ) as never[],
      });
      for (const warning of dietary.warnings) {
        issues.push({
          recipeVersionId: row.id,
          recipeId: row.recipeId,
          versionNumber: row.versionNumber,
          code: warning.code,
          detail: warning.message,
        });
      }

      const kcal = Number(nutrition.calories ?? NaN);
      if (Number.isFinite(kcal) && kcal < 0) {
        issues.push({
          recipeVersionId: row.id,
          recipeId: row.recipeId,
          versionNumber: row.versionNumber,
          code: 'NEGATIVE_NUTRITION',
          detail: `calories=${kcal}`,
        });
      }

      // Serving/nutrition inconsistency: snapshot calories present but zero ingredients.
      if (Number.isFinite(kcal) && kcal > 0 && ingredients.length === 0) {
        issues.push({
          recipeVersionId: row.id,
          recipeId: row.recipeId,
          versionNumber: row.versionNumber,
          code: 'SERVING_NUTRITION_INCONSISTENT',
          detail: 'nutrition without ingredients',
        });
      }

      if (issues.length > before) stats.withIssues += 1;
      void productIds;
    }

    const strategy =
      issues.length === 0
        ? {
            chosen: 'NONE_REQUIRED',
            note: 'No corrective RecipeVersion v2 needed; published v1 snapshots pass read-only checks.',
          }
        : {
            chosen: 'A_DATA_CORRECTION_V2',
            note:
              'Published immutable v1 must not be UPDATEd. Emit correcting RecipeVersion v2 with changeType=DATA_CORRECTION for affected recipes; MealItems stay on pinned v1 until explicit plan revision.',
          };

    const report = {
      package: 'RP2-02A',
      generatedAt: new Date().toISOString(),
      mode: 'READ_ONLY',
      immutableRule: 'Published RecipeVersion must never be UPDATEd in place',
      strategy,
      stats,
      issueCount: issues.length,
      issuesByCode: issues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue.code] = (acc[issue.code] ?? 0) + 1;
        return acc;
      }, {}),
      issues: issues.slice(0, 500),
    };

    const outDir = resolve(process.cwd(), '../../docs/recipe-platform');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'RP2_02A_SNAPSHOT_VALIDATION_REPORT.json');
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ outPath, issueCount: issues.length, strategy: strategy.chosen, stats }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
