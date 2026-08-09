import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  MealItemCustomizationSnapshot,
  RecipeContentProvenance,
  RecipeContentSnapshot,
  RecipeIngredientSnapshot,
  RecipeNutritionSnapshot,
  RecipeRestrictionSnapshot,
  RecipeStepSnapshot,
} from '../domain/recipe-version.policy';

export type ResolvedRecipeContent = {
  recipeId: string;
  recipeVersionId: string | null;
  versionNumber: number | null;
  provenance: RecipeContentProvenance;
  content: RecipeContentSnapshot;
  ingredients: RecipeIngredientSnapshot[];
  steps: RecipeStepSnapshot[];
  nutrition: RecipeNutritionSnapshot;
  restrictions: RecipeRestrictionSnapshot;
  servings: number;
  servingWeightGrams: number | null;
  customization: MealItemCustomizationSnapshot | null;
};

@Injectable()
export class RecipeContentResolver {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async resolveForMealItem(mealItemId: string): Promise<ResolvedRecipeContent | null> {
    const row = await this.db.query<{
      mealItemId: string;
      recipeId: string | null;
      recipeVersionId: string | null;
      contentProvenance: string | null;
      customizationSnapshotJson: unknown;
      servings: string;
      versionNumber: number | null;
      contentSnapshotJson: unknown;
      ingredientsSnapshotJson: unknown;
      stepsSnapshotJson: unknown;
      nutritionSnapshotJson: unknown;
      restrictionSnapshotJson: unknown;
      servingWeightGrams: string | null;
      versionServings: number | null;
      recipeName: string | null;
      description: string | null;
      prepMinutes: number | null;
      cookMinutes: number | null;
      difficulty: string | null;
      portionGrams: string | null;
      allergens: unknown;
      dietaryTags: unknown;
      equipment: unknown;
      recipeKey: string | null;
      recipeServings: number | null;
    }>(
      `SELECT
         mi.id AS "mealItemId",
         mi."recipeId",
         mi."recipeVersionId",
         mi."contentProvenance",
         mi."customizationSnapshotJson",
         mi.servings::text AS servings,
         v."versionNumber",
         v."contentSnapshotJson",
         v."ingredientsSnapshotJson",
         v."stepsSnapshotJson",
         v."nutritionSnapshotJson",
         v."restrictionSnapshotJson",
         v."servingWeightGrams"::text AS "servingWeightGrams",
         v.servings AS "versionServings",
         r.name AS "recipeName",
         r.description,
         r."prepMinutes",
         r."cookMinutes",
         r.difficulty,
         r."portionGrams"::text AS "portionGrams",
         r.allergens,
         r."dietaryTags",
         r.equipment,
         r."recipeKey",
         r.servings AS "recipeServings"
       FROM "MealItem" mi
       LEFT JOIN "RecipeVersion" v ON v.id = mi."recipeVersionId"
       LEFT JOIN "Recipe" r ON r.id = COALESCE(mi."recipeId", v."recipeId")
       WHERE mi.id = $1`,
      [mealItemId],
    );
    const item = row.rows[0];
    if (!item) return null;

    if (item.recipeVersionId && item.contentSnapshotJson) {
      const content = item.contentSnapshotJson as RecipeContentSnapshot;
      const customization = (item.customizationSnapshotJson as MealItemCustomizationSnapshot | null) ?? null;
      const ingredients = customization?.ingredients?.length
        ? customization.ingredients
        : ((item.ingredientsSnapshotJson as RecipeIngredientSnapshot[]) ?? []);
      const nutrition = customization?.nutrition ??
        ((item.nutritionSnapshotJson as RecipeNutritionSnapshot) ?? emptyNutrition());
      return {
        recipeId: item.recipeId ?? '',
        recipeVersionId: item.recipeVersionId,
        versionNumber: item.versionNumber,
        provenance: customization
          ? 'MEAL_ITEM_CUSTOMIZATION'
          : ((item.contentProvenance as RecipeContentProvenance) ?? 'RECIPE_VERSION'),
        content,
        ingredients,
        steps: (item.stepsSnapshotJson as RecipeStepSnapshot[]) ?? [],
        nutrition,
        restrictions: (item.restrictionSnapshotJson as RecipeRestrictionSnapshot) ?? {
          allergens: content.allergens ?? [],
          dietaryTags: content.dietaryTags ?? [],
        },
        servings: item.versionServings ?? (Number(item.servings) || 1),
        servingWeightGrams:
          item.servingWeightGrams != null ? Number(item.servingWeightGrams) : (content.portionGrams ?? null),
        customization,
      };
    }

    // Legacy fallback — live Recipe (explicit provenance, not version-pinned).
    if (!item.recipeId || !item.recipeName) return null;
    const liveIngredients = await this.db.query<{
      productId: string;
      displayName: string | null;
      amount: string;
      unit: string;
    }>(
      `SELECT ri."productId", COALESCE(p."canonicalName", p.name) AS "displayName",
              ri.quantity::text AS amount, ri.unit
       FROM "RecipeIngredient" ri
       LEFT JOIN "Product" p ON p.id = ri."productId"
       WHERE ri."recipeId" = $1
       ORDER BY ri.id`,
      [item.recipeId],
    );
    const liveSteps = await this.db.query<RecipeStepSnapshot>(
      `SELECT "stepIndex", instruction, "durationMinutes", "temperatureC", equipment
       FROM "RecipeStep" WHERE "recipeId" = $1 ORDER BY "stepIndex"`,
      [item.recipeId],
    );
    const content: RecipeContentSnapshot = {
      title: item.recipeName,
      description: item.description,
      servings: item.recipeServings ?? 1,
      prepMinutes: item.prepMinutes,
      cookMinutes: item.cookMinutes,
      difficulty: item.difficulty,
      portionGrams: item.portionGrams != null ? Number(item.portionGrams) : null,
      equipment: asStringArray(item.equipment),
      recipeKey: item.recipeKey,
      allergens: asStringArray(item.allergens),
      dietaryTags: asStringArray(item.dietaryTags),
    };
    return {
      recipeId: item.recipeId,
      recipeVersionId: null,
      versionNumber: null,
      provenance: 'LEGACY_RECIPE_CURRENT',
      content,
      ingredients: liveIngredients.rows.map((ing, index) => ({
        productId: ing.productId,
        canonicalProductId: ing.productId,
        displayName: ing.displayName ?? ing.productId,
        amount: Number(ing.amount),
        unit: ing.unit,
        ordering: index + 1,
      })),
      steps: liveSteps.rows,
      nutrition: emptyNutrition('LEGACY_LIVE_RECIPE'),
      restrictions: {
        allergens: content.allergens,
        dietaryTags: content.dietaryTags,
      },
      servings: content.servings,
      servingWeightGrams: content.portionGrams,
      customization: null,
    };
  }
}

function emptyNutrition(source = 'EMPTY'): RecipeNutritionSnapshot {
  return { calories: 0, proteinG: 0, fatG: 0, carbsG: 0, basis: 'per_recipe_servings', source };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}
