import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../product-catalog/application/product-foundation.resolvers';
import { ProductPriceResolver } from '../../product-catalog/application/product-roles-retail.resolvers';
import { compareMealSlots } from '../domain/meal-dish.ordering';
import {
  dayMacroTargets,
  macrosFromIngredient,
  shareOfDay,
  sumMacros,
  validateNonNegativeMacros,
  type MacroTotals,
} from '../domain/meal-dish.nutrition';
import { costForIngredient, priceSourceLabel, summarizeDishCost } from '../domain/meal-dish.pricing';
import { resolvePortionScale } from '../domain/meal-nutrition.contract';
import {
  resolveDishAllergens,
  resolveDishDietaryTags,
  userAllergenLabels,
  userDietaryLabels,
} from '../domain/dish-restrictions.policy';
import type {
  IngredientDetailDto,
  MealDishCardDto,
  MealDishDetailDto,
  MealPlanDayDetailDto,
  RecipeStepDto,
} from '../domain/meal-dish.types';
import type { NutritionTargets } from '../domain/meal-plan.nutrition';
import { MealDishCatalogRepository } from '../infrastructure/meal-dish-catalog.repository';
import { RecipeContentResolver } from '../../recipe-platform/application/recipe-content.resolver';

type MealRow = {
  mealPlanId: string;
  mealPlanVersion: number;
  dayId: string;
  dayIndex: number;
  mealId: string;
  mealItemId: string;
  mealName: string;
  mealType: string | null;
  plannedTime: string | null;
  recipeId: string;
  dishId: string;
  recipeName: string;
  description: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: string | null;
  portionGrams: number | null;
  itemPortionGrams: number | null;
  servings: string;
  allergens: unknown;
  dietaryTags: unknown;
  equipment: unknown;
  recipeVersionId: string | null;
  recipeVersionNumber: number | null;
};

type IngredientRow = {
  productId: string;
  displayName: string;
  amount: string;
  unit: string;
  caloriesPer100g: string;
  proteinPer100g: string;
  fatPer100g: string;
  carbsPer100g: string;
  packageSize: string | null;
  packageUnit: string | null;
};

@Injectable()
export class MealDishDetailService {
  private readonly logger = new Logger(MealDishDetailService.name);

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(MealDishCatalogRepository) private readonly catalog: MealDishCatalogRepository,
    @Optional() @Inject(ProductNutritionResolver) private readonly nutrition?: ProductNutritionResolver,
    @Optional() @Inject(ProductRestrictionResolver) private readonly restrictions?: ProductRestrictionResolver,
    @Optional() @Inject(ProductPriceResolver) private readonly prices?: ProductPriceResolver,
    @Optional() @Inject(RecipeContentResolver) private readonly recipeContent?: RecipeContentResolver,
  ) {}

  async getDayDetail(
    userId: string,
    dayIndex: number,
    targets: NutritionTargets | null,
    planId?: string,
  ): Promise<MealPlanDayDetailDto> {
    await this.catalog.ensureCatalog();
    const plan = await this.resolvePlan(userId, planId);
    const meals = await this.loadMealsForDay(userId, plan.id, dayIndex);
    if (!meals.length) throw new Error('MEAL_PLAN_DAY_NOT_FOUND');

    const cards = await Promise.all(meals.map((meal) => this.toCard(meal)));
    cards.sort(compareMealSlots);
    const planned = sumMacros(cards.map((card) => ({
      calories: card.calories,
      proteinG: card.proteinG,
      fatG: card.fatG,
      carbsG: card.carbsG,
    })));
    const target = dayMacroTargets(targets?.targetKcal ?? planned.calories, targets?.proteinG ?? planned.proteinG);
    const calorieMismatch = targets?.targetKcal
      ? Math.abs(planned.calories - targets.targetKcal) > Math.max(50, targets.targetKcal * 0.08)
      : false;

    return {
      mealPlanId: plan.id,
      mealPlanVersion: plan.version,
      dayId: meals[0].dayId,
      dayIndex,
      target,
      planned,
      mealCount: cards.length,
      calorieMismatch,
      mismatchMessage: calorieMismatch
        ? `Сумма блюд (${Math.round(planned.calories)} ккал) отличается от дневной цели (${targets?.targetKcal} ккал)`
        : null,
      items: cards,
    };
  }

  async getItemDetails(userId: string, mealItemId: string, targets: NutritionTargets | null): Promise<MealDishDetailDto> {
    await this.catalog.ensureCatalog();
    const meal = await this.loadMealByItemId(userId, mealItemId);
    if (!meal) throw new Error('MEAL_PLAN_ITEM_FORBIDDEN');
    const card = await this.toCard(meal);
    const built = await this.buildIngredientsAndSteps(meal);
    const dayTarget = dayMacroTargets(
      targets?.targetKcal ?? card.calories,
      targets?.proteinG ?? card.proteinG,
    );
    return {
      ...card,
      ingredients: built.ingredients,
      steps: built.steps,
      equipment: asStringArray(meal.equipment),
      dayTargets: dayTarget,
      daySharePercent: shareOfDay(
        { calories: card.calories, proteinG: card.proteinG, fatG: card.fatG, carbsG: card.carbsG },
        dayTarget,
      ),
      validationStatus: built.validationStatus,
      validationMessage: built.validationMessage,
    };
  }

  private async resolvePlan(userId: string, planId?: string): Promise<{ id: string; version: number }> {
    if (planId) {
      const owned = await this.db.query<{ id: string; version: number }>(
        'SELECT id, version FROM "Plan" WHERE id = $1 AND "userId" = $2',
        [planId, userId],
      );
      if (!owned.rows[0]) throw new Error('MEAL_PLAN_FORBIDDEN');
      return owned.rows[0];
    }
    const latest = await this.db.query<{ id: string; version: number }>(
      'SELECT id, version FROM "Plan" WHERE "userId" = $1 ORDER BY version DESC LIMIT 1',
      [userId],
    );
    if (!latest.rows[0]) throw new Error('MEAL_PLAN_NOT_FOUND');
    return latest.rows[0];
  }

  private async loadMealsForDay(userId: string, planId: string, dayIndex: number): Promise<MealRow[]> {
    const result = await this.db.query<MealRow>(
      `SELECT
         p.id AS "mealPlanId",
         p.version AS "mealPlanVersion",
         pd.id AS "dayId",
         pd."dayIndex",
         m.id AS "mealId",
         mi.id AS "mealItemId",
         m.name AS "mealName",
         m."mealType",
         m."plannedTime",
         r.id AS "recipeId",
         r.id AS "dishId",
         mi."portionGrams" AS "itemPortionGrams",
         mi.servings::text AS servings,
         mi."recipeVersionId",
         v."versionNumber" AS "recipeVersionNumber",
         COALESCE(v."contentSnapshotJson"->>'title', r.name) AS "recipeName",
         COALESCE(v."contentSnapshotJson"->>'description', r.description) AS description,
         COALESCE((v."contentSnapshotJson"->>'prepMinutes')::int, r."prepMinutes") AS "prepMinutes",
         COALESCE((v."contentSnapshotJson"->>'cookMinutes')::int, r."cookMinutes") AS "cookMinutes",
         COALESCE(v."contentSnapshotJson"->>'difficulty', r.difficulty) AS difficulty,
         COALESCE(v."servingWeightGrams", r."portionGrams") AS "portionGrams",
         COALESCE(v."restrictionSnapshotJson"->'allergens', r.allergens) AS allergens,
         COALESCE(v."restrictionSnapshotJson"->'dietaryTags', r."dietaryTags") AS "dietaryTags",
         COALESCE(v."contentSnapshotJson"->'equipment', r.equipment) AS equipment
       FROM "Plan" p
       JOIN "PlanDay" pd ON pd."planId" = p.id
       JOIN "Meal" m ON m."planDayId" = pd.id
       JOIN "MealItem" mi ON mi."mealId" = m.id
       JOIN "Recipe" r ON r.id = mi."recipeId"
       LEFT JOIN "RecipeVersion" v ON v.id = mi."recipeVersionId"
       WHERE p."userId" = $1 AND p.id = $2 AND pd."dayIndex" = $3
       ORDER BY m."plannedTime" NULLS LAST, m.name`,
      [userId, planId, dayIndex],
    );
    return result.rows;
  }

  private async loadMealByItemId(userId: string, mealItemId: string): Promise<MealRow | null> {
    const result = await this.db.query<MealRow>(
      `SELECT
         p.id AS "mealPlanId",
         p.version AS "mealPlanVersion",
         pd.id AS "dayId",
         pd."dayIndex",
         m.id AS "mealId",
         mi.id AS "mealItemId",
         m.name AS "mealName",
         m."mealType",
         m."plannedTime",
         r.id AS "recipeId",
         r.id AS "dishId",
         mi."portionGrams" AS "itemPortionGrams",
         mi.servings::text AS servings,
         mi."recipeVersionId",
         v."versionNumber" AS "recipeVersionNumber",
         COALESCE(v."contentSnapshotJson"->>'title', r.name) AS "recipeName",
         COALESCE(v."contentSnapshotJson"->>'description', r.description) AS description,
         COALESCE((v."contentSnapshotJson"->>'prepMinutes')::int, r."prepMinutes") AS "prepMinutes",
         COALESCE((v."contentSnapshotJson"->>'cookMinutes')::int, r."cookMinutes") AS "cookMinutes",
         COALESCE(v."contentSnapshotJson"->>'difficulty', r.difficulty) AS difficulty,
         COALESCE(v."servingWeightGrams", r."portionGrams") AS "portionGrams",
         COALESCE(v."restrictionSnapshotJson"->'allergens', r.allergens) AS allergens,
         COALESCE(v."restrictionSnapshotJson"->'dietaryTags', r."dietaryTags") AS "dietaryTags",
         COALESCE(v."contentSnapshotJson"->'equipment', r.equipment) AS equipment
       FROM "MealItem" mi
       JOIN "Meal" m ON m.id = mi."mealId"
       JOIN "PlanDay" pd ON pd.id = m."planDayId"
       JOIN "Plan" p ON p.id = pd."planId"
       JOIN "Recipe" r ON r.id = mi."recipeId"
       LEFT JOIN "RecipeVersion" v ON v.id = mi."recipeVersionId"
       WHERE mi.id = $1 AND p."userId" = $2`,
      [mealItemId, userId],
    );
    return result.rows[0] ?? null;
  }

  private async toCard(meal: MealRow): Promise<MealDishCardDto> {
    const built = await this.buildIngredientsAndSteps(meal);
    const totals = built.totals;
    const cost = summarizeDishCost(built.ingredients.map((item) => ({
      productId: item.productId,
      displayName: item.displayName,
      consumedCostRub: item.consumedCostRub,
      packageCostRub: item.packageCostRub,
      priceStatus: item.priceStatus,
      collectedAt: item.observedAt ?? undefined,
      sourceName: item.priceSource ?? undefined,
      retailerName: item.retailer ?? undefined,
    })));

    const recipeAllergens = asStringArray(meal.allergens);
    const claimedTags = asStringArray(meal.dietaryTags);
    const productAllergenCodes: string[] = [];
    if (this.restrictions && built.ingredients.length) {
      const restMap = await this.restrictions.resolveForProducts(
        built.ingredients.map((ing) => ing.productId),
      );
      for (const rest of restMap.values()) {
        productAllergenCodes.push(...rest.allergenCodes, ...rest.allergenLegacyCodes);
      }
    }
    const allergenResolved = resolveDishAllergens({
      recipeTokens: recipeAllergens,
      productAllergenCodes,
    });
    const dietaryResolved = resolveDishDietaryTags({
      claimedTags,
      ingredientNames: built.ingredients.map((ing) => ing.displayName),
      allergenCodes: allergenResolved.internalCodes,
    });

    const portionGrams = built.contract.displayedPortionGrams;
    const prep = meal.prepMinutes;
    const cook = meal.cookMinutes;
    const totalMinutes =
      prep != null || cook != null ? (prep ?? 0) + (cook ?? 0) : null;

    const allergenLabels = userAllergenLabels(allergenResolved.user);
    const dietaryLabels = userDietaryLabels(dietaryResolved.user);

    return {
      mealPlanId: meal.mealPlanId,
      mealPlanVersion: meal.mealPlanVersion,
      dayId: meal.dayId,
      dayIndex: meal.dayIndex,
      mealId: meal.mealId,
      mealItemId: meal.mealItemId,
      dishId: meal.dishId,
      recipeId: meal.recipeId,
      recipeVersionId: meal.recipeVersionId,
      recipeVersionNumber: meal.recipeVersionNumber,
      dishName: meal.recipeName || meal.mealName,
      description: meal.description,
      mealType: meal.mealType ?? 'extra',
      plannedTime: meal.plannedTime,
      portionGrams,
      portionLabel: portionGrams != null ? `${Math.round(portionGrams)} г` : 'Нет данных',
      nutritionBasis: built.contract.nutritionBasis,
      baseServingGrams: built.contract.baseServingGrams,
      servingMultiplier: built.contract.servingMultiplier,
      displayedPortionGrams: built.contract.displayedPortionGrams,
      displayedNutrition: built.contract.displayedNutrition,
      calories: totals.calories,
      proteinG: totals.proteinG,
      fatG: totals.fatG,
      carbsG: totals.carbsG,
      prepMinutes: prep,
      cookMinutes: cook,
      totalMinutes,
      difficulty: meal.difficulty,
      dietaryTags: dietaryLabels,
      allergens: allergenLabels,
      allergenDetails: allergenResolved.user,
      dietaryTagDetails: dietaryResolved.user,
      cost,
      substitutionReady: {
        mealPlanId: meal.mealPlanId,
        mealPlanVersion: meal.mealPlanVersion,
        dayId: meal.dayId,
        dayIndex: meal.dayIndex,
        mealItemId: meal.mealItemId,
        dishId: meal.dishId,
        recipeId: meal.recipeId,
        recipeVersionId: meal.recipeVersionId,
        portionGrams,
        nutritionalTotals: totals,
        ingredientProductIds: built.ingredients.map((item) => item.productId),
        ingredients: built.ingredients.map((item) => ({
          productId: item.productId,
          displayName: item.displayName,
          amount: item.amount,
          unit: item.unit,
          label: `${item.displayName} — ${formatAmount(item.amount)} ${item.unit === 'ml' ? 'мл' : 'г'}`,
        })),
        dietaryTags: dietaryLabels,
        allergenFlags: allergenLabels,
        priceCoverage: {
          complete: cost.complete,
          missingIngredientCount: cost.missingIngredientCount,
        },
      },
    };
  }

  private async buildIngredientsAndSteps(meal: MealRow): Promise<{
    ingredients: IngredientDetailDto[];
    steps: RecipeStepDto[];
    totals: MacroTotals;
    contract: ReturnType<typeof resolvePortionScale> & {
      nutritionBasis: 'PER_BASE_SERVING' | 'CUSTOMIZATION';
      baseServingGrams: number | null;
      displayedNutrition: MacroTotals;
    };
    validationStatus: 'ok' | 'warning';
    validationMessage: string | null;
  }> {
    const resolved =
      this.recipeContent && typeof this.recipeContent.resolveForMealItem === 'function'
        ? await this.recipeContent.resolveForMealItem(meal.mealItemId)
        : null;

    let sourceIngredients: Array<{
      productId: string;
      displayName: string;
      amount: number;
      unit: string;
    }> = [];
    let steps: RecipeStepDto[] = [];
    let baseServingGrams: number | null =
      meal.portionGrams != null && Number(meal.portionGrams) > 0 ? Number(meal.portionGrams) : null;
    let nutritionBasis: 'PER_BASE_SERVING' | 'CUSTOMIZATION' = 'PER_BASE_SERVING';

    if (resolved && resolved.recipeVersionId) {
      baseServingGrams =
        resolved.servingWeightGrams ??
        resolved.content.portionGrams ??
        baseServingGrams;
      nutritionBasis = resolved.customization ? 'CUSTOMIZATION' : 'PER_BASE_SERVING';
      sourceIngredients = resolved.ingredients.map((ing) => ({
        productId: ing.productId,
        displayName: ing.displayName,
        amount: Number(ing.amount),
        unit: ing.unit,
      }));
      steps = resolved.steps.map((step) => ({
        stepIndex: step.stepIndex,
        instruction: step.instruction,
        durationMinutes: step.durationMinutes,
        temperatureC: step.temperatureC,
        equipment: step.equipment,
      }));
    } else {
      const ingredientRows = await this.db.query<IngredientRow>(
        `SELECT
           p.id AS "productId",
           COALESCE(p.name, p."canonicalName") AS "displayName",
           ri.quantity::text AS amount,
           ri.unit,
           p."caloriesPer100g"::text AS "caloriesPer100g",
           p."proteinPer100g"::text AS "proteinPer100g",
           COALESCE(p."fatPer100g", 0)::text AS "fatPer100g",
           COALESCE(p."carbsPer100g", 0)::text AS "carbsPer100g",
           p."packageSize"::text AS "packageSize",
           p."packageUnit"
         FROM "RecipeIngredient" ri
         JOIN "Product" p ON p.id = ri."productId"
         WHERE ri."recipeId" = $1
         ORDER BY p."canonicalName"`,
        [meal.recipeId],
      );
      sourceIngredients = ingredientRows.rows.map((row) => ({
        productId: row.productId,
        displayName: row.displayName,
        amount: Number(row.amount),
        unit: row.unit,
      }));
      const stepRows = await this.db.query<RecipeStepDto>(
        `SELECT "stepIndex", instruction, "durationMinutes", "temperatureC", equipment
         FROM "RecipeStep" WHERE "recipeId" = $1 ORDER BY "stepIndex"`,
        [meal.recipeId],
      );
      steps = stepRows.rows;
    }

    const scale = resolvePortionScale({
      baseServingGrams,
      displayedPortionGrams: meal.itemPortionGrams ?? baseServingGrams,
      servingMultiplier: Number(meal.servings) || 1,
    });

    const productIds = sourceIngredients.map((r) => r.productId);
    const priceMap = this.prices ? await this.prices.resolveForProducts(productIds) : null;
    const ingredients: IngredientDetailDto[] = [];
    for (const row of sourceIngredients) {
      const amount = roundAmount(Number(row.amount) * scale.totalScale);
      const resolvedNutrition = this.nutrition
        ? await this.nutrition.resolveForProduct(row.productId)
        : {
            calories: 0,
            protein: 0,
            fat: 0,
            carbohydrate: 0,
            status: 'UNVERSIONED_LEGACY' as const,
          };
      if (resolvedNutrition.status === 'MISSING') {
        this.logger.warn(`PRODUCT_NUTRITION_MISSING:${row.productId}`);
      }
      const macros = macrosFromIngredient({
        amount,
        unit: row.unit,
        caloriesPer100g: resolvedNutrition.calories,
        proteinPer100g: resolvedNutrition.protein,
        fatPer100g: resolvedNutrition.fat,
        carbsPer100g: resolvedNutrition.carbohydrate,
      });
      const quote = priceMap?.get(row.productId);
      const packageSize = quote?.packageWeight ?? null;
      const packageUnit = quote?.packageUnit ?? null;
      const packagePriceRub = quote?.packagePriceRub ?? null;
      const cost = costForIngredient({
        productId: row.productId,
        displayName: row.displayName,
        amount,
        unit: row.unit,
        packageSize,
        packageUnit,
        packagePriceRub,
        collectedAt: quote?.collectedAt ?? null,
        sourceName: quote?.provenance ?? null,
        retailerName: quote?.retailerName ?? null,
      });
      let priceStatus: IngredientDetailDto['priceStatus'] = cost.priceStatus;
      if (quote?.provenance === 'LEGACY_PRODUCT_PRICE' && cost.priceStatus === 'confirmed') {
        priceStatus = 'legacy';
      } else if (quote?.provenance === 'PRICE_INCOMPLETE' || quote?.coverage === 'PARTIAL') {
        priceStatus = 'partial';
      } else if (quote?.provenance === 'PRICE_MISSING') {
        priceStatus = 'missing';
      }
      ingredients.push({
        productId: row.productId,
        displayName: row.displayName,
        amount,
        unit: row.unit,
        gramsEquivalent: row.unit === 'g' || row.unit === 'ml' ? amount : null,
        calories: macros.calories,
        proteinG: macros.proteinG,
        fatG: macros.fatG,
        carbsG: macros.carbsG,
        consumedCostRub: cost.consumedCostRub,
        packageCostRub: cost.packageCostRub,
        priceStatus,
        priceSource: quote?.provenance ?? null,
        priceSourceLabel: priceSourceLabel(quote?.provenance ?? null),
        retailer: quote?.retailerName ?? null,
        packageWeight: packageSize,
        packageUnit,
        priceConfidence: quote?.confidence ?? null,
        observedAt: quote?.collectedAt ?? null,
        stale: false,
      });
    }

    const totals = sumMacros(ingredients);
    validateNonNegativeMacros(totals);
    return {
      ingredients,
      steps,
      totals,
      contract: {
        ...scale,
        nutritionBasis,
        baseServingGrams,
        displayedNutrition: totals,
      },
      validationStatus: 'ok',
      validationMessage: null,
    };
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function roundAmount(value: number): number {
  return Math.round(value * 10) / 10;
}
