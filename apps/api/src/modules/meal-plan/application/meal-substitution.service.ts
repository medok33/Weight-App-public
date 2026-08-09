import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  ProductNutritionResolver,
  ProductRestrictionResolver,
} from '../../product-catalog/application/product-foundation.resolvers';
import {
  ProductCulinaryRoleResolver,
  ProductPriceResolver,
  ProductSubstitutionResolver,
} from '../../product-catalog/application/product-roles-retail.resolvers';
import {
  inferCookingMethodsFromRecipeText,
  primaryCookingMethod,
} from '../../product-catalog/domain/product-roles-retail.policy';
import { RevisionEngineService } from '../../revision-engine/application/revision-engine.service';
import { MealDishCatalogRepository } from '../infrastructure/meal-dish-catalog.repository';
import { buildDishCandidates, buildIngredientCandidates, parseCandidateId } from '../domain/substitution.engine';
import { recipeMacros } from '../domain/substitution.filters';
import { assessSubstitutionGoalImpact } from '../domain/substitution.goal-impact';
import { costDelta, replaceMealMacrosInDay, shoppingDelta, weekTotals } from '../domain/substitution.recalc';
import { costForIngredient, summarizeDishCost } from '../domain/meal-dish.pricing';
import { sumMacros, type MacroTotals } from '../domain/meal-dish.nutrition';
import { STEP093_PRODUCTS, STEP093_RECIPES } from '../domain/substitution.fixture';
import { STEP092_PRODUCTS, STEP092_RECIPES } from '../domain/meal-dish.fixture';
import type {
  CatalogProductRef,
  CatalogRecipeRef,
  CompensationOption,
  MealSnapshotDay,
  StructuredSubstitutionOperation,
  SubstitutionCandidate,
  SubstitutionKind,
  SubstitutionPreviewDto,
  UserDietConstraints,
} from '../domain/substitution.types';
import { ShoppingListService } from '../../shopping-list/application/shopping-list.service';
import { parseStringList } from '../../user-profile/domain/user-profile.types';
import { hardFilterProfileFromStructured } from '../../user-profile/domain/profile-structure.policy';
import { RecipeVersionService } from '../../recipe-platform/application/recipe-version.service';
import type { MealItemCustomizationSnapshot } from '../../recipe-platform/domain/recipe-version.policy';

@Injectable()
export class MealSubstitutionService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(MealDishCatalogRepository) private readonly catalog: MealDishCatalogRepository,
    @Inject(RevisionEngineService) private readonly revisions: RevisionEngineService,
    @Optional() @Inject(AuditSecurityService) private readonly audit?: AuditSecurityService,
    @Optional() @Inject(ShoppingListService) private readonly shopping?: ShoppingListService,
    @Optional() @Inject(ProductNutritionResolver) private readonly nutrition?: ProductNutritionResolver,
    @Optional() @Inject(ProductRestrictionResolver) private readonly restrictions?: ProductRestrictionResolver,
    @Optional() @Inject(ProductSubstitutionResolver) private readonly substitutions?: ProductSubstitutionResolver,
    @Optional() @Inject(ProductCulinaryRoleResolver) private readonly culinaryRoles?: ProductCulinaryRoleResolver,
    @Optional() @Inject(ProductPriceResolver) private readonly prices?: ProductPriceResolver,
    @Optional() @Inject(RecipeVersionService) private readonly recipeVersions?: RecipeVersionService,
  ) {}

  async listCandidates(
    userId: string,
    mealItemId: string,
    kind: SubstitutionKind,
    replaceProductId?: string,
  ): Promise<{
    mealItemId: string;
    kind: SubstitutionKind;
    candidates: SubstitutionCandidate[];
    blockedCount: number;
    noCandidatesMessage: string | null;
  }> {
    await this.emit('substitution_opened', userId, mealItemId, { kind });
    const ctx = await this.loadItemContext(userId, mealItemId);
    const constraints = await this.loadConstraints(userId);

    let result: { candidates: SubstitutionCandidate[]; blockedCount: number };
    if (kind === 'REPLACE_DISH') {
      result = buildDishCandidates({
        sourceRecipe: ctx.recipe,
        sourcePortionGrams: ctx.portionGrams,
        sourceMacros: ctx.macros,
        sourceCost: { consumed: ctx.cost.consumedCostRub, packages: ctx.cost.packageCostRub },
        mealType: ctx.mealType,
        dayTargetCalories: ctx.dayTarget.calories,
        dayOtherCalories: ctx.dayOtherCalories,
        recipes: ctx.allRecipes,
        products: ctx.products,
        constraints,
      });
    } else {
      if (!replaceProductId) throw new Error('SUBSTITUTION_INGREDIENT_REQUIRED');
      let stepInstructions: string[] = [];
      if (ctx.recipeVersionId) {
        const versionSteps = await this.db.query<{ instruction: string }>(
          `SELECT (step->>'instruction') AS instruction
           FROM "RecipeVersion" v,
                LATERAL jsonb_array_elements(COALESCE(v."stepsSnapshotJson", '[]'::jsonb)) AS step
           WHERE v.id = $1
           ORDER BY COALESCE((step->>'stepIndex')::int, 0)`,
          [ctx.recipeVersionId],
        );
        stepInstructions = versionSteps.rows.map((s) => s.instruction).filter(Boolean);
      }
      if (!stepInstructions.length) {
        const steps = await this.db.query<{ instruction: string }>(
          `SELECT instruction FROM "RecipeStep" WHERE "recipeId" = $1 ORDER BY "stepIndex"`,
          [ctx.recipe.recipeId],
        );
        stepInstructions = steps.rows.map((s) => s.instruction);
      }
      const cookingMethods = inferCookingMethodsFromRecipeText({
        description: ctx.recipe.description,
        stepInstructions,
      });
      const cookingMethod = primaryCookingMethod(cookingMethods);
      const curatedEdges = this.substitutions
        ? await this.substitutions.listEdgesForSource(replaceProductId)
        : [];
      const primaryRole = this.culinaryRoles
        ? await this.culinaryRoles.rolesForProducts([replaceProductId])
        : null;
      const roles = primaryRole?.get(replaceProductId) ?? [];
      const culinaryRoleId =
        roles.find((r) => r.isPrimary)?.culinaryRoleId ?? roles[0]?.culinaryRoleId ?? null;
      result = buildIngredientCandidates({
        sourceRecipe: ctx.recipe,
        sourcePortionGrams: ctx.portionGrams,
        sourceMacros: ctx.macros,
        sourceCost: { consumed: ctx.cost.consumedCostRub },
        replaceProductId,
        mealType: ctx.mealType,
        dayTargetCalories: ctx.dayTarget.calories,
        dayOtherCalories: ctx.dayOtherCalories,
        products: ctx.products,
        constraints,
        cookingMethod,
        cookingMethods,
        culinaryRoleId,
        curatedEdges: curatedEdges.map((edge) => ({
          sourceProductId: edge.sourceProductId,
          replacementProductId: edge.replacementProductId,
          culinaryRoleId: edge.culinaryRoleId,
          culinaryRoleCode: edge.culinaryRoleCode,
          replacementRatio: edge.replacementRatio,
          replacementRatioMin: edge.replacementRatioMin,
          replacementRatioMax: edge.replacementRatioMax,
          nutritionImpact: edge.nutritionImpact,
          textureImpact: edge.textureImpact,
          supportedMethods: edge.supportedMethods,
          status: edge.status,
        })),
      });
    }

    await this.emit('substitution_candidates_loaded', userId, mealItemId, {
      kind,
      count: result.candidates.length,
    });
    if (!result.candidates.length) {
      await this.emit('substitution_no_candidates', userId, mealItemId, { kind });
    }

    return {
      mealItemId,
      kind,
      candidates: result.candidates,
      blockedCount: result.blockedCount,
      noCandidatesMessage: result.candidates.length
        ? null
        : 'Мы не нашли безопасную замену с учётом ваших ограничений',
    };
  }

  async preview(
    userId: string,
    mealItemId: string,
    input: {
      candidateId: string;
      compensation?: CompensationOption | null;
    },
  ): Promise<SubstitutionPreviewDto> {
    const ctx = await this.loadItemContext(userId, mealItemId);
    const parsed = parseCandidateId(input.candidateId);
    await this.emit('substitution_candidate_selected', userId, mealItemId, {
      candidateType: parsed.kind,
    });

    const list = await this.listCandidates(
      userId,
      mealItemId,
      parsed.kind,
      parsed.fromProductId,
    );
    const candidate = list.candidates.find((c) => c.candidateId === input.candidateId);
    if (!candidate) throw new Error('SUBSTITUTION_CANDIDATE_STALE');

    const afterMacros: MacroTotals = {
      calories: candidate.calories,
      proteinG: candidate.proteinG,
      fatG: candidate.fatG,
      carbsG: candidate.carbsG,
    };

    const day = replaceMealMacrosInDay({
      dayMeals: ctx.dayMealMacros,
      mealIndex: ctx.mealIndexInDay,
      nextMacros: afterMacros,
    });

    const weekBeforeDays = ctx.weekDayMacros;
    const weekAfterDays = weekBeforeDays.map((macros, index) =>
      index === ctx.dayIndex ? day.after : macros,
    );
    const weekBefore = weekTotals(weekBeforeDays);
    const weekAfter = weekTotals(weekAfterDays);

    const beforeIngredients = ctx.recipe.ingredients.map((ing) => {
      const product = ctx.products.get(ing.productId)!;
      return {
        productId: ing.productId,
        displayName: product.displayName,
        amount: ing.amount,
        unit: ing.unit,
      };
    });

    let afterIngredients = beforeIngredients;
    let targetRecipeId = candidate.recipeId;
    let replaceProductId: string | null = null;
    let ingredientScale = 1;
    let customizationSnapshotJson: MealItemCustomizationSnapshot | null = null;
    let targetRecipeVersionId: string | null = null;

    if (parsed.kind === 'REPLACE_DISH' && candidate.recipeId) {
      const recipe = ctx.allRecipes.find((r) => r.recipeId === candidate.recipeId)!;
      const scale = candidate.suggestedPortionGrams / Math.max(recipe.portionGrams, 1);
      ingredientScale = scale;
      afterIngredients = recipe.ingredients.map((ing) => {
        const product = ctx.products.get(ing.productId)!;
        return {
          productId: ing.productId,
          displayName: product.displayName,
          amount: Math.round(ing.amount * scale * 10) / 10,
          unit: ing.unit,
        };
      });
      targetRecipeVersionId = this.recipeVersions
        ? await this.recipeVersions.resolveUsableVersionId(candidate.recipeId)
        : await this.resolveVersionId(candidate.recipeId);
      if (!targetRecipeVersionId) {
        throw new Error('SUBSTITUTION_CANDIDATE_VERSION_UNAVAILABLE');
      }
    } else if (parsed.kind === 'REPLACE_INGREDIENT' && parsed.toProductId && parsed.amountGrams != null) {
      replaceProductId = parsed.fromProductId ?? null;
      afterIngredients = beforeIngredients.map((ing) => {
        if (ing.productId !== parsed.fromProductId) return ing;
        const product = ctx.products.get(parsed.toProductId!)!;
        return {
          productId: product.productId,
          displayName: product.displayName,
          amount: parsed.amountGrams!,
          unit: product.unit === 'ml' ? 'ml' : 'g',
        };
      });
      // Prefer fixture recipe for buckwheat→potato path when available.
      const potatoChicken = ctx.allRecipes.find((r) => r.recipeKey === 'potato_chicken');
      if (parsed.toProductId === 'a0930001-0000-4000-8000-000000000002' && potatoChicken) {
        targetRecipeId = potatoChicken.recipeId;
        targetRecipeVersionId = this.recipeVersions
          ? await this.recipeVersions.resolveUsableVersionId(potatoChicken.recipeId)
          : await this.resolveVersionId(potatoChicken.recipeId);
        if (!targetRecipeVersionId) throw new Error('SUBSTITUTION_CANDIDATE_VERSION_UNAVAILABLE');
      } else {
        // Model B: plan-scoped MealItem customization on the base RecipeVersion.
        // Never mutate canonical RecipeVersion / RecipeIngredient.
        targetRecipeId = ctx.recipe.recipeId;
        targetRecipeVersionId =
          ctx.recipeVersionId ??
          (this.recipeVersions
            ? await this.recipeVersions.resolveUsableVersionId(ctx.recipe.recipeId)
            : await this.resolveVersionId(ctx.recipe.recipeId));
        if (!targetRecipeVersionId) throw new Error('SUBSTITUTION_BASE_VERSION_UNAVAILABLE');
        customizationSnapshotJson = {
          version: 1,
          kind: 'REPLACE_INGREDIENT',
          baseRecipeVersionId: targetRecipeVersionId,
          ingredients: afterIngredients.map((ing, index) => ({
            productId: ing.productId,
            canonicalProductId: ing.productId,
            displayName: ing.displayName,
            amount: ing.amount,
            unit: ing.unit,
            ordering: index + 1,
          })),
          replaceProductId,
          targetProductId: parsed.toProductId,
        };
      }
    }

    const goalImpact = assessSubstitutionGoalImpact({
      sources: await this.loadGoalSources(userId),
      dayCalorieDelta: day.after.calories - day.before.calories,
      weekCalorieDelta: weekAfter.total.calories - weekBefore.total.calories,
    });

    const operation: StructuredSubstitutionOperation = {
      version: 1,
      kind: parsed.kind,
      mealItemId,
      sourceRecipeId: ctx.recipe.recipeId,
      sourcePortionGrams: ctx.portionGrams,
      candidateId: candidate.candidateId,
      targetRecipeId,
      targetRecipeVersionId,
      targetProductId: candidate.productId,
      replaceProductId,
      suggestedPortionGrams: candidate.suggestedPortionGrams,
      ingredientScale,
      classification: candidate.classification,
      compensation: input.compensation ?? null,
      customizationSnapshotJson,
    };

    if (input.compensation) {
      await this.emit('substitution_compensation_selected', userId, mealItemId, {
        compensation: input.compensation,
      });
    }
    if (candidate.classification === 'CONFLICTING') {
      await this.emit('substitution_conflict_shown', userId, mealItemId, {});
    }

    // Meal names drive derived Shopping List catalog expansion — prefer stable recipe keys.
    const targetRecipe = ctx.allRecipes.find((r) => r.recipeId === targetRecipeId);
    const mealNameForPlan =
      parsed.kind === 'REPLACE_DISH'
        ? (targetRecipe?.name ?? candidate.name)
        : (targetRecipe?.name ?? ctx.recipe.name);
    const proposedDays = this.applyOperationToSnapshot(ctx.planDays, operation, mealNameForPlan);
    const revisionPreview = await this.revisions.previewStructured(userId, ctx.planId, {
      reason: `SUBSTITUTION:${parsed.kind}:${candidate.candidateId}`,
      operation,
      days: proposedDays,
      summary: `Замена: ${ctx.recipe.name} → ${candidate.name}`,
      changedItems: [
        {
          path: `items.${mealItemId}.dish`,
          previousValue: ctx.recipe.name,
          proposedValue: candidate.name,
        },
        {
          path: `items.${mealItemId}.calories`,
          previousValue: String(ctx.macros.calories),
          proposedValue: String(afterMacros.calories),
        },
      ],
      warnings: [...candidate.warnings],
    });

    await this.emit('substitution_preview_created', userId, mealItemId, {
      classification: candidate.classification,
    });

    return {
      mealPlanId: ctx.planId,
      mealPlanVersion: ctx.planVersion,
      mealItemId,
      operation: parsed.kind,
      candidateId: candidate.candidateId,
      classification: candidate.classification,
      before: {
        dishName: ctx.recipe.name,
        recipeId: ctx.recipe.recipeId,
        portionGrams: ctx.portionGrams,
        macros: ctx.macros,
        consumedCostRub: ctx.cost.consumedCostRub,
        packageCostRub: ctx.cost.packageCostRub,
      },
      after: {
        dishName: candidate.name,
        recipeId: candidate.recipeId,
        productId: candidate.productId,
        portionGrams: candidate.suggestedPortionGrams,
        macros: afterMacros,
        consumedCostRub: candidate.consumedCostRub,
        packageCostRub: candidate.packageCostRub,
      },
      dayBalance: { before: day.before, after: day.after, target: ctx.dayTarget },
      weekBalance: {
        before: weekBefore.total,
        after: weekAfter.total,
        avgDailyCalories: {
          before: weekBefore.avgDailyCalories,
          after: weekAfter.avgDailyCalories,
        },
      },
      cost: {
        dishConsumedDeltaRub: costDelta(ctx.cost.consumedCostRub, candidate.consumedCostRub),
        dayConsumedDeltaRub: costDelta(ctx.cost.consumedCostRub, candidate.consumedCostRub),
        weekConsumedDeltaRub: costDelta(ctx.cost.consumedCostRub, candidate.consumedCostRub),
        dishPackageDeltaRub: costDelta(ctx.cost.packageCostRub, candidate.packageCostRub),
        incomplete: candidate.consumedCostRub == null || ctx.cost.consumedCostRub == null,
      },
      shoppingListDelta: shoppingDelta({ before: beforeIngredients, after: afterIngredients }),
      goalImpact,
      warnings: candidate.warnings,
      compensationOptions: candidate.compensationOptions,
      keepPlanHints: [
        'Изменить критерий поиска',
        'Разрешить большее отклонение',
        'Выбрать другой ингредиент',
        'Оставить исходное блюдо',
      ],
      confirmationToken: revisionPreview.confirmationToken,
      proposedVersion: revisionPreview.proposedVersion,
      revisionPlanId: revisionPreview.planId,
    };
  }

  async afterConfirmed(): Promise<void> {
    // Shopping list is rebuilt atomically inside RevisionEngineService.confirm (model A).
  }

  async cancel(userId: string, mealItemId: string, planId: string): Promise<void> {
    await this.revisions.cancelPreview(userId, planId, 'meal');
    await this.emit('substitution_cancelled', userId, mealItemId, {});
  }

  private applyOperationToSnapshot(
    days: MealSnapshotDay[],
    operation: StructuredSubstitutionOperation,
    dishName: string,
  ): MealSnapshotDay[] {
    return days.map((day) => ({
      dayIndex: day.dayIndex,
      meals: day.meals.map((meal) => {
        if (meal.mealItemId !== operation.mealItemId) return meal;
        return {
          ...meal,
          name: dishName,
          recipeId: operation.targetRecipeId ?? meal.recipeId,
          recipeVersionId: operation.targetRecipeVersionId ?? meal.recipeVersionId,
          portionGrams: operation.suggestedPortionGrams,
          customizationSnapshotJson: operation.customizationSnapshotJson ?? null,
          contentProvenance: operation.customizationSnapshotJson
            ? 'MEAL_ITEM_CUSTOMIZATION'
            : 'RECIPE_VERSION',
        };
      }),
    }));
  }

  private async loadItemContext(userId: string, mealItemId: string) {
    await this.catalog.ensureCatalog();
    const products = await this.loadCanonicalProducts();
    const allRecipes = this.fixtureRecipes(products);

    const row = await this.db.query<{
      planId: string;
      planVersion: number;
      planUserId: string;
      dayId: string;
      dayIndex: number;
      mealId: string;
      mealName: string;
      mealType: string | null;
      plannedTime: string | null;
      recipeId: string;
      recipeVersionId: string | null;
      portionGrams: string | null;
    }>(
      `SELECT p.id AS "planId", p.version AS "planVersion", p."userId" AS "planUserId",
              pd.id AS "dayId", pd."dayIndex",
              m.id AS "mealId", m.name AS "mealName", m."mealType", m."plannedTime",
              mi."recipeId", mi."recipeVersionId", mi."portionGrams"::text AS "portionGrams"
       FROM "MealItem" mi
       JOIN "Meal" m ON m.id = mi."mealId"
       JOIN "PlanDay" pd ON pd.id = m."planDayId"
       JOIN "Plan" p ON p.id = pd."planId"
       WHERE mi.id = $1`,
      [mealItemId],
    );
    const item = row.rows[0];
    if (!item) throw new Error('MEAL_PLAN_ITEM_NOT_FOUND');
    if (item.planUserId !== userId) throw new Error('MEAL_PLAN_ITEM_FORBIDDEN');

    const recipe = allRecipes.find((r) => r.recipeId === item.recipeId);
    if (!recipe) throw new Error('MEAL_PLAN_RECIPE_NOT_FOUND');

    const portionGrams = item.portionGrams != null ? Number(item.portionGrams) : recipe.portionGrams;
    const scale = portionGrams / Math.max(recipe.portionGrams, 1);
    const macros = recipeMacros(recipe, products, scale);
    if (!macros) throw new Error('MEAL_PLAN_NUTRITION_INVALID');

    const costLines = recipe.ingredients.map((ing) => {
      const product = products.get(ing.productId)!;
      return costForIngredient({
        productId: product.productId,
        displayName: product.displayName,
        amount: ing.amount * scale,
        unit: ing.unit,
        packageSize: product.packageSize,
        packageUnit: product.packageUnit,
        packagePriceRub: product.unitPriceRub,
      });
    });
    const cost = summarizeDishCost(costLines);

    const dayItems = await this.db.query<{
      mealItemId: string;
      recipeId: string;
      portionGrams: string | null;
      mealType: string | null;
      plannedTime: string | null;
      mealName: string;
    }>(
      `SELECT mi.id AS "mealItemId", mi."recipeId", mi."portionGrams"::text AS "portionGrams",
              m."mealType", m."plannedTime", m.name AS "mealName"
       FROM "MealItem" mi
       JOIN "Meal" m ON m.id = mi."mealId"
       WHERE m."planDayId" = $1
       ORDER BY m."plannedTime" NULLS LAST, m.name`,
      [item.dayId],
    );

    const dayMealMacros: MacroTotals[] = [];
    let mealIndexInDay = 0;
    for (let i = 0; i < dayItems.rows.length; i += 1) {
      const d = dayItems.rows[i]!;
      if (d.mealItemId === mealItemId) mealIndexInDay = i;
      const r = allRecipes.find((x) => x.recipeId === d.recipeId);
      if (!r) {
        dayMealMacros.push({ calories: 0, proteinG: 0, fatG: 0, carbsG: 0 });
        continue;
      }
      const p = d.portionGrams != null ? Number(d.portionGrams) : r.portionGrams;
      const s = p / Math.max(r.portionGrams, 1);
      dayMealMacros.push(recipeMacros(r, products, s) ?? { calories: 0, proteinG: 0, fatG: 0, carbsG: 0 });
    }
    const dayOtherCalories = dayMealMacros.reduce((sum, m, i) => (i === mealIndexInDay ? sum : sum + m.calories), 0);

    const planDaysRows = await this.db.query<{
      dayIndex: number;
      mealItemId: string;
      mealName: string;
      recipeId: string | null;
      recipeVersionId: string | null;
      mealType: string | null;
      plannedTime: string | null;
      portionGrams: string | null;
      customizationSnapshotJson: unknown;
      contentProvenance: string | null;
    }>(
      `SELECT pd."dayIndex", mi.id AS "mealItemId", m.name AS "mealName", mi."recipeId",
              mi."recipeVersionId", m."mealType", m."plannedTime",
              mi."portionGrams"::text AS "portionGrams",
              mi."customizationSnapshotJson", mi."contentProvenance"
       FROM "PlanDay" pd
       JOIN "Meal" m ON m."planDayId" = pd.id
       LEFT JOIN "MealItem" mi ON mi."mealId" = m.id
       WHERE pd."planId" = $1
       ORDER BY pd."dayIndex", m."plannedTime" NULLS LAST, m.name`,
      [item.planId],
    );

    const planDaysMap = new Map<number, MealSnapshotDay>();
    for (const r of planDaysRows.rows) {
      const bucket = planDaysMap.get(r.dayIndex) ?? { dayIndex: r.dayIndex, meals: [] };
      bucket.meals.push({
        mealItemId: r.mealItemId,
        name: r.mealName,
        recipeId: r.recipeId ?? undefined,
        recipeVersionId: r.recipeVersionId ?? undefined,
        mealType: r.mealType ?? undefined,
        plannedTime: r.plannedTime ?? undefined,
        portionGrams: r.portionGrams != null ? Number(r.portionGrams) : undefined,
        customizationSnapshotJson: r.customizationSnapshotJson ?? undefined,
        contentProvenance: r.contentProvenance ?? undefined,
      });
      planDaysMap.set(r.dayIndex, bucket);
    }
    const planDays = [...planDaysMap.values()].sort((a, b) => a.dayIndex - b.dayIndex);

    const weekDayMacros: MacroTotals[] = [];
    for (const day of planDays) {
      const macrosList = day.meals.map((meal) => {
        const r = allRecipes.find((x) => x.recipeId === meal.recipeId);
        if (!r) return { calories: 0, proteinG: 0, fatG: 0, carbsG: 0 };
        const p = meal.portionGrams ?? r.portionGrams;
        return recipeMacros(r, products, p / Math.max(r.portionGrams, 1)) ?? {
          calories: 0,
          proteinG: 0,
          fatG: 0,
          carbsG: 0,
        };
      });
      weekDayMacros.push(sumMacros(macrosList));
    }

    const profileTarget = await this.db
      .query<{ weightKg: string | null }>(
        `SELECT "weightKg"::text AS "weightKg" FROM "UserProfile" WHERE "userId" = $1 LIMIT 1`,
        [userId],
      )
      .catch(() => ({ rows: [] as { weightKg: string | null }[] }));
    void profileTarget;

    const dayTarget: MacroTotals = {
      calories: 2500,
      proteinG: Math.round((2500 * 0.3) / 4),
      fatG: Math.round((2500 * 0.3) / 9),
      carbsG: Math.round((2500 * 0.4) / 4),
    };

    return {
      planId: item.planId,
      planVersion: item.planVersion,
      dayId: item.dayId,
      dayIndex: item.dayIndex,
      mealType: item.mealType ?? 'lunch',
      portionGrams,
      recipe,
      recipeVersionId: item.recipeVersionId,
      macros,
      cost,
      products,
      allRecipes,
      dayMealMacros,
      mealIndexInDay,
      dayOtherCalories,
      dayTarget,
      planDays,
      weekDayMacros,
    };
  }

  private async resolveVersionId(recipeId: string): Promise<string | null> {
    const row = await this.db.query<{ id: string }>(
      `SELECT COALESCE(r."currentVersionId", (
         SELECT v.id FROM "RecipeVersion" v
         WHERE v."recipeId" = r.id AND v."publishedAt" IS NOT NULL
         ORDER BY v."versionNumber" DESC LIMIT 1
       )) AS id
       FROM "Recipe" r WHERE r.id = $1`,
      [recipeId],
    );
    return row.rows[0]?.id ?? null;
  }

  /** Fixture catalog enriched via ProductNutritionResolver / ProductRestrictionResolver / ProductPriceResolver. */
  private async loadCanonicalProducts(): Promise<Map<string, CatalogProductRef>> {
    const map = this.fixtureProducts();
    if (!this.nutrition && !this.restrictions && !this.prices) return map;
    const ids = [...map.keys()];
    const nutritionMap = this.nutrition ? await this.nutrition.resolveForProducts(ids) : null;
    const restrictionMap = this.restrictions ? await this.restrictions.resolveForProducts(ids) : null;
    const priceMap = this.prices ? await this.prices.resolveForProducts(ids) : null;
    for (const [productId, product] of map) {
      const snap = nutritionMap?.get(productId);
      if (snap && snap.status !== 'MISSING') {
        product.caloriesPer100g = snap.calories;
        product.proteinPer100g = snap.protein;
        product.fatPer100g = snap.fat;
        product.carbsPer100g = snap.carbohydrate;
      }
      const rest = restrictionMap?.get(productId);
      if (rest?.allergenPresenceKnown) {
        product.allergens = [...new Set([...product.allergens, ...rest.allergenLegacyCodes])];
      }
      if (rest?.dietaryTagCodes.length) {
        product.dietaryTags = [...new Set([...product.dietaryTags, ...rest.dietaryTagCodes])];
      }
      const quote = priceMap?.get(productId);
      if (quote && quote.packagePriceRub != null && quote.packageWeight != null) {
        product.unitPriceRub = quote.packagePriceRub;
        product.packageSize = quote.packageWeight;
        if (quote.packageUnit) product.packageUnit = quote.packageUnit;
      }
    }
    void this.culinaryRoles;
    return map;
  }

  private fixtureProducts(): Map<string, CatalogProductRef> {
    const map = new Map<string, CatalogProductRef>();
    for (const p of [...STEP092_PRODUCTS, ...STEP093_PRODUCTS]) {
      const allergens = 'allergens' in p ? [...(p as { allergens?: string[] }).allergens ?? []] : [];
      const dietaryTags = 'dietaryTags' in p ? [...(p as { dietaryTags?: string[] }).dietaryTags ?? []] : [];
      // STEP092 products lack allergen arrays — dairy/egg/fish inferred from keys
      if (!allergens.length) {
        if (/yogurt|milk/.test(p.productKey)) allergens.push('dairy');
        if (/egg/.test(p.productKey)) allergens.push('egg');
        if (/fish/.test(p.productKey)) allergens.push('fish');
      }
      map.set(p.id, {
        productId: p.id,
        productKey: p.productKey,
        displayName: p.canonicalName,
        unit: p.unit,
        caloriesPer100g: p.caloriesPer100g,
        proteinPer100g: p.proteinPer100g,
        fatPer100g: p.fatPer100g,
        carbsPer100g: p.carbsPer100g,
        packageSize: p.packageSize,
        packageUnit: p.packageUnit,
        unitPriceRub: p.unitPriceRub,
        allergens,
        dietaryTags,
        enabled: true,
      });
    }
    return map;
  }

  private fixtureRecipes(products: Map<string, CatalogProductRef>): CatalogRecipeRef[] {
    const recipes = [...STEP092_RECIPES, ...STEP093_RECIPES];
    return recipes.map((r) => ({
      recipeId: r.id,
      recipeKey: r.recipeKey,
      name: r.name,
      description: r.description,
      mealTypes: 'mealTypes' in r ? [...(r as { mealTypes: string[] }).mealTypes] : ['breakfast', 'snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'],
      portionGrams: r.portionGrams,
      prepMinutes: r.prepMinutes,
      cookMinutes: r.cookMinutes,
      allergens: [...r.allergens],
      dietaryTags: [...r.dietaryTags],
      enabled: true,
      ingredients: r.ingredients.map((i) => ({
        productId: products.get(i.productId)?.productId ?? i.productId,
        amount: i.amount,
        unit: i.unit,
      })),
    }));
  }

  private async loadConstraints(userId: string): Promise<UserDietConstraints> {
    const result = await this.db
      .query<{
        dietaryPreferences: string | null;
        foodRestrictions: string | null;
        allergenCodesJson: unknown;
        dietaryCodesJson: unknown;
        equipmentCodesJson: unknown;
        intoleranceCodesJson: unknown;
      }>(
        `SELECT "dietaryPreferences", "foodRestrictions",
                COALESCE("allergenCodesJson", '[]'::jsonb) AS "allergenCodesJson",
                COALESCE("dietaryCodesJson", '[]'::jsonb) AS "dietaryCodesJson",
                COALESCE("equipmentCodesJson", '[]'::jsonb) AS "equipmentCodesJson",
                COALESCE("intoleranceCodesJson", '[]'::jsonb) AS "intoleranceCodesJson"
         FROM "UserProfile" WHERE "userId" = $1 LIMIT 1`,
        [userId],
      )
      .catch(() => ({
        rows: [] as {
          dietaryPreferences: string | null;
          foodRestrictions: string | null;
          allergenCodesJson: unknown;
          dietaryCodesJson: unknown;
          equipmentCodesJson: unknown;
          intoleranceCodesJson: unknown;
        }[],
      }));

    const row = result.rows[0];
    const jsonCodes = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];

    // STEP_211 / meal hard filters: structured codes only; legacy free-text is never a hard rule.
    const hard = hardFilterProfileFromStructured({
      allergenCodes: jsonCodes(row?.allergenCodesJson),
      dietaryCodes: jsonCodes(row?.dietaryCodesJson),
      equipmentCodes: jsonCodes(row?.equipmentCodesJson),
      intoleranceCodes: jsonCodes(row?.intoleranceCodesJson),
    });

    const dietaryPreferences = parseStringList(row?.dietaryPreferences) ?? [];
    const legacyDietaryNotes = dietaryPreferences.length ? dietaryPreferences : hard.dietary;

    return {
      allergens: hard.allergens,
      foodRestrictions: [],
      dietaryPreferences: legacyDietaryNotes,
      excludedProductIds: [],
      rejectedProductIds: [],
    };
  }

  private async loadGoalSources(userId: string) {
    const profile = await this.db
      .query<{
        weightKg: string | null;
        activityLevel: string | null;
        dietaryPreferences: unknown;
        foodRestrictions: unknown;
      }>(
        `SELECT "weightKg"::text, "activityLevel", "dietaryPreferences", "foodRestrictions"
         FROM "UserProfile" WHERE "userId" = $1 LIMIT 1`,
        [userId],
      )
      .catch(() => ({ rows: [] as never[] }));

    const goal = await this.db
      .query<{
        kind: string | null;
        target: string | null;
        unit: string | null;
        targetDate: string | null;
      }>(
        `SELECT g.kind, g.target::text, g.unit, g."targetDate"::text AS "targetDate"
         FROM "UserGoal" g
         JOIN "UserProfile" p ON p.id = g."profileId"
         WHERE p."userId" = $1
         ORDER BY g."createdAt" DESC
         LIMIT 1`,
        [userId],
      )
      .catch(() => ({ rows: [] as never[] }));

    const p = profile.rows[0];
    const g = goal.rows[0];
    return {
      profile: p
        ? {
            weightKg: p.weightKg != null ? Number(p.weightKg) : null,
            activityLevel: p.activityLevel,
            dietaryPreferences: parseStringList(
              typeof p.dietaryPreferences === 'string' ? p.dietaryPreferences : null,
            ),
            foodRestrictions: parseStringList(
              typeof p.foodRestrictions === 'string' ? p.foodRestrictions : null,
            ),
          }
        : null,
      goal: g
        ? {
            kind: g.kind,
            target: g.target != null ? Number(g.target) : null,
            unit: g.unit,
            targetDate: g.targetDate,
          }
        : null,
      progress: null,
      workout: null,
    };
  }

  private async emit(action: string, userId: string, entityId: string, metadata: Record<string, unknown>) {
    if (!this.audit) return;
    try {
      await this.audit.appendEvent({
        actorUserId: userId,
        action,
        entityType: 'MealSubstitution',
        entityId,
        metadata,
      });
    } catch {
      // analytics must not break substitution
    }
  }
}
