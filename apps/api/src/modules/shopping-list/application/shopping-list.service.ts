import { Inject, Injectable, Optional } from '@nestjs/common';
import { MealPlanService } from '../../meal-plan/application/meal-plan.service';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { resolvePortionScale } from '../../meal-plan/domain/meal-nutrition.contract';
import { sanitizeUserShoppingPriceFields, classifyPriceObservationHeuristics } from '../../product-catalog/domain/price-data-class.policy';
import { aggregateCatalogIngredients, splitCosts } from '../domain/shopping-list.policy';
import { assertShoppingTxAllowed } from '../domain/shopping-tx-fail.hook';
import type { ShoppingBudget, ShoppingListRecord, ShoppingListSyncStatus } from '../domain/shopping-list.types';
import { ShoppingListRepository } from '../infrastructure/shopping-list.repository';

export type MealDayForShopping = {
  dayIndex: number;
  meals: {
    name: string;
    recipeId?: string;
    recipeVersionId?: string;
    portionGrams?: number;
    servings?: number;
    customizationSnapshotJson?: unknown;
  }[];
};

type SnapshotIngredient = {
  productId: string;
  canonicalProductId?: string;
  displayName?: string;
  amount: number;
  unit: string;
};

@Injectable()
export class ShoppingListService {
  constructor(
    @Optional() @Inject(ShoppingListRepository) private readonly repository?: ShoppingListRepository,
    @Optional() @Inject(MealPlanService) private readonly mealPlanService?: MealPlanService,
    @Optional() @Inject(PrismaService) private readonly db?: PrismaService,
  ) {}

  async generateFromMealPlan(userId: string): Promise<ShoppingListRecord> {
    if (!userId) throw new Error('SHOPPING_USER_REQUIRED');
    if (!this.repository || !this.mealPlanService) throw new Error('SHOPPING_DEPENDENCY_MISSING');

    const plan = await this.mealPlanService.getActivePlan(userId);
    if (!plan.days.length || !plan.planId) throw new Error('SHOPPING_MEAL_PLAN_EMPTY');

    return this.rebuildFromPlanId(userId, plan.planId, plan.version);
  }

  /**
   * Preferred production path: expand from pinned RecipeVersion (+ customization) for the plan.
   */
  async rebuildFromPlanId(
    userId: string,
    planId: string,
    planVersion: number,
    query?: SqlQuery,
  ): Promise<ShoppingListRecord> {
    if (!this.repository || !this.db) throw new Error('SHOPPING_DEPENDENCY_MISSING');
    const run = query ?? ((text: string, values: unknown[] = []) => this.db!.query(text, values));

    const rows = await run<{
      dayIndex: number;
      mealName: string;
      recipeId: string | null;
      recipeVersionId: string | null;
      portionGrams: string | null;
      servings: string;
      customizationSnapshotJson: unknown;
      servingWeightGrams: string | null;
      ingredientsSnapshotJson: unknown;
    }>(
      `SELECT
         pd."dayIndex",
         m.name AS "mealName",
         mi."recipeId",
         mi."recipeVersionId",
         mi."portionGrams"::text AS "portionGrams",
         mi.servings::text AS servings,
         mi."customizationSnapshotJson",
         v."servingWeightGrams"::text AS "servingWeightGrams",
         v."ingredientsSnapshotJson"
       FROM "Plan" p
       JOIN "PlanDay" pd ON pd."planId" = p.id
       JOIN "Meal" m ON m."planDayId" = pd.id
       LEFT JOIN "MealItem" mi ON mi."mealId" = m.id
       LEFT JOIN "RecipeVersion" v ON v.id = mi."recipeVersionId"
       WHERE p.id = $1 AND p."userId" = $2
       ORDER BY pd."dayIndex", m."plannedTime" NULLS LAST, m.name`,
      [planId, userId],
    );

    const days: MealDayForShopping[] = [];
    const byDay = new Map<number, MealDayForShopping['meals']>();
    for (const row of rows.rows) {
      const bucket = byDay.get(row.dayIndex) ?? [];
      bucket.push({
        name: row.mealName,
        recipeId: row.recipeId ?? undefined,
        recipeVersionId: row.recipeVersionId ?? undefined,
        portionGrams: row.portionGrams != null ? Number(row.portionGrams) : undefined,
        servings: Number(row.servings) || 1,
        customizationSnapshotJson: row.customizationSnapshotJson ?? undefined,
      });
      byDay.set(row.dayIndex, bucket);
    }
    for (const [dayIndex, meals] of byDay.entries()) {
      days.push({ dayIndex, meals });
    }

    return this.rebuildFromVersionedMeals(userId, days, rows.rows, {
      sourcePlanId: planId,
      sourcePlanVersion: planVersion,
    }, query);
  }

  /**
   * Atomic rebuild for STEP_093 substitution confirm — must run on the same SqlQuery
   * as Plan / PlanRevision inserts so failures roll back the whole revision.
   */
  async rebuildFromMealDays(
    userId: string,
    days: MealDayForShopping[],
    meta: { sourcePlanId: string; sourcePlanVersion: number },
    query?: SqlQuery,
  ): Promise<ShoppingListRecord> {
    if (meta.sourcePlanId && this.db) {
      return this.rebuildFromPlanId(userId, meta.sourcePlanId, meta.sourcePlanVersion, query);
    }
    // Strict path requires plan id — empty list is not acceptable for production.
    throw new Error('SHOPPING_PLAN_ID_REQUIRED');
  }

  private async rebuildFromVersionedMeals(
    userId: string,
    days: MealDayForShopping[],
    snapshotRows: Array<{
      dayIndex: number;
      recipeVersionId: string | null;
      portionGrams: string | null;
      servings: string;
      customizationSnapshotJson: unknown;
      servingWeightGrams: string | null;
      ingredientsSnapshotJson: unknown;
    }>,
    meta: { sourcePlanId: string; sourcePlanVersion: number },
    query?: SqlQuery,
  ): Promise<ShoppingListRecord> {
    if (!this.repository) throw new Error('SHOPPING_DEPENDENCY_MISSING');
    assertShoppingTxAllowed('before_list');

    const expanded: Array<{
      productKey: string;
      name: string;
      category: string;
      quantity: number;
      unit: string;
      packageSize: number;
      fallbackUnitPrice: number;
      productId?: string;
      dayIndex: number;
    }> = [];

    for (const row of snapshotRows) {
      // Skip Meal rows without a MealItem (LEFT JOIN padding).
      if (!row.recipeVersionId && row.ingredientsSnapshotJson == null) continue;
      if (!row.recipeVersionId) {
        throw new Error('SHOPPING_MEAL_ITEM_VERSION_REQUIRED');
      }
      const customization = row.customizationSnapshotJson as
        | { ingredients?: SnapshotIngredient[] }
        | null;
      const baseIngredients = (row.ingredientsSnapshotJson as SnapshotIngredient[]) ?? [];
      const ingredients =
        customization?.ingredients?.length ? customization.ingredients : baseIngredients;
      if (!ingredients.length) continue;

      const baseServingGrams =
        row.servingWeightGrams != null && Number(row.servingWeightGrams) > 0
          ? Number(row.servingWeightGrams)
          : null;
      const scale = resolvePortionScale({
        baseServingGrams,
        displayedPortionGrams:
          row.portionGrams != null ? Number(row.portionGrams) : baseServingGrams,
        servingMultiplier: Number(row.servings) || 1,
      });

      for (const ingredient of ingredients) {
        const productId = ingredient.canonicalProductId ?? ingredient.productId;
        const amount = Number(ingredient.amount) * scale.totalScale;
        if (!(amount > 0) || !productId) continue;

        let productKey = productId;
        let displayName = ingredient.displayName ?? productId;
        let packageSize = 500;
        const fallbackUnitPrice = 100;
        if (this.db && /^[0-9a-f-]{36}$/i.test(productId)) {
          const product = await (query ?? ((text: string, values: unknown[] = []) => this.db!.query(text, values)))<{
            productKey: string | null;
            name: string | null;
            canonicalName: string;
            packageSize: string | null;
          }>(
            `SELECT "productKey", name, "canonicalName", "packageSize"::text AS "packageSize"
             FROM "Product" WHERE id = $1 LIMIT 1`,
            [productId],
          );
          if (product.rows[0]) {
            productKey = product.rows[0].productKey ?? product.rows[0].canonicalName;
            displayName = product.rows[0].name ?? product.rows[0].canonicalName;
            if (product.rows[0].packageSize != null) packageSize = Number(product.rows[0].packageSize) || 500;
          }
        }

        expanded.push({
          productKey,
          name: displayName,
          category: 'other',
          quantity: amount,
          unit: ingredient.unit || 'g',
          packageSize,
          fallbackUnitPrice,
          productId,
          dayIndex: row.dayIndex,
        });
      }
    }

    if (!expanded.length) throw new Error('SHOPPING_MEAL_PLAN_EMPTY');

    const aggregated = aggregateCatalogIngredients(expanded);
    const storeId = await this.repository.ensurePriceCatalogStore(query);

    const priced = [];
    for (const [index, item] of aggregated.entries()) {
      if (index === 0) assertShoppingTxAllowed('mid_items');
      const source = expanded.find((row) => row.productKey === item.productKey);
      let productId = source?.productId;
      if (productId && /^[0-9a-f-]{36}$/i.test(productId)) {
        // Keep canonical Product id from snapshot.
      } else {
        productId = await this.repository.ensureProduct(item.productKey || item.name, item.unit, query);
      }
      const quote = await this.repository.ensureObservation(productId!, storeId, item.packagePrice, query);
      const costs = splitCosts(item.quantity, item.packageSize, quote.price);
      const sanitized = sanitizeUserShoppingPriceFields({
        retailerName: quote.retailerName,
        priceSourceName: quote.sourceName,
        priceSourceType: quote.sourceType,
        hasPrice: quote.price != null && Number(quote.price) >= 0,
        locale: 'ru',
        dataClass: (quote as { dataClass?: string }).dataClass ?? 'PRODUCTION',
      });
      priced.push({
        ...item,
        productId: productId!,
        unitPrice: quote.price,
        estimatedCost: Number(costs.purchaseCost.toFixed(2)),
        priceSourceType: quote.sourceType,
        priceSourceName: sanitized.priceSourceName ?? sanitized.priceStatusLabel,
        priceCollectedAt: quote.collectedAt,
        retailerName: sanitized.retailerName,
        retailerCode: undefined,
      });
    }

    const list = await this.repository.createListForPlan(userId, priced, meta, query);
    return this.withSyncStatus(list, meta.sourcePlanVersion);
  }

  async getLatest(userId: string): Promise<ShoppingListRecord | null> {
    if (!userId) throw new Error('SHOPPING_USER_REQUIRED');
    if (!this.repository) return null;
    const list = await this.repository.findLatestByUserId(userId);
    if (!list) return null;
    const activeVersion = await this.activePlanVersion(userId);
    return this.withSyncStatus(list, activeVersion);
  }

  async setPurchased(userId: string, itemId: string, purchased: boolean): Promise<ShoppingListRecord> {
    if (!this.repository) throw new Error('SHOPPING_DEPENDENCY_MISSING');
    const list = await this.repository.setPurchased(userId, itemId, purchased);
    const activeVersion = await this.activePlanVersion(userId);
    return this.withSyncStatus(list, activeVersion);
  }

  async getBudget(userId: string): Promise<ShoppingBudget> {
    const list = await this.getLatest(userId);
    const weekCost = list?.estimatedTotal ?? 0;
    return {
      todayCost: Number((weekCost / 7).toFixed(2)),
      weekCost: Number(weekCost.toFixed(2)),
      currency: 'RUB',
    };
  }

  private async activePlanVersion(userId: string): Promise<number | null> {
    if (!this.mealPlanService) return null;
    try {
      const plan = await this.mealPlanService.getActivePlan(userId);
      return plan.version;
    } catch {
      return null;
    }
  }

  private withSyncStatus(list: ShoppingListRecord, activePlanVersion: number | null): ShoppingListRecord {
    const items = (list.items ?? []).map((item) => {
      const inferredDataClass =
        item.priceDataClass ??
        classifyPriceObservationHeuristics({
          sourceName: item.priceSourceName,
          retailerCode: item.retailerCode,
          source: item.priceSourceType,
        });
      const sanitized = sanitizeUserShoppingPriceFields({
        retailerName: item.retailerName,
        priceSourceName: item.priceSourceName,
        priceSourceType: item.priceSourceType,
        hasPrice: item.estimatedUnitPrice != null && Number(item.estimatedUnitPrice) >= 0,
        locale: 'ru',
        dataClass: inferredDataClass,
      });
      const rest = { ...item };
      delete rest.priceDataClass;
      return {
        ...rest,
        retailerName: sanitized.retailerName ?? undefined,
        retailerCode: undefined,
        priceSourceName: sanitized.priceSourceName ?? sanitized.priceStatusLabel,
        // Never expose internal dataClass / fixture provenance on USER DTO.
        priceDataClass: undefined,
      };
    });
    return {
      ...list,
      items,
      syncStatus: resolveSyncStatus(list, activePlanVersion),
    };
  }
}

export function resolveSyncStatus(
  list: Pick<ShoppingListRecord, 'sourcePlanVersion' | 'generationStatus'>,
  activePlanVersion: number | null,
): ShoppingListSyncStatus {
  if (list.generationStatus === 'FAILED') return 'failed';
  if (list.generationStatus === 'REBUILDING') return 'rebuilding';
  if (list.generationStatus === 'STALE') return 'stale';
  if (activePlanVersion == null || list.sourcePlanVersion == null) return 'unknown';
  if (list.sourcePlanVersion === activePlanVersion && list.generationStatus === 'CURRENT') return 'current';
  return 'stale';
}
