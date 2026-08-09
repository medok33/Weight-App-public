import {
  evaluateSubstitutionEligibility,
  selectCompatibleCuratedEdge,
} from '../../product-catalog/domain/product-roles-retail.policy';
import type { SubstitutionEligibilityEdge } from '../../product-catalog/domain/product-roles-retail.types';
import { classifySubstitution } from './substitution.classify';
import { hardFilterIngredientProduct, hardFilterRecipe, recipeMacros } from './substitution.filters';
import { suggestIngredientAmountWithMacros, suggestPortion } from './substitution.portion';
import { rankScore, sortCandidatesStable } from './substitution.ranking';
import { costForIngredient, summarizeDishCost } from './meal-dish.pricing';
import type { MacroTotals } from './meal-dish.nutrition';
import { macrosFromIngredient, sumMacros } from './meal-dish.nutrition';
import type {
  CatalogProductRef,
  CatalogRecipeRef,
  SubstitutionCandidate,
  SubstitutionKind,
  UserDietConstraints,
} from './substitution.types';

function macroDelta(after: MacroTotals, before: MacroTotals) {
  const pct = (a: number, b: number) => {
    if (Math.abs(b) < 1e-6) return a === 0 ? 0 : 100;
    return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
  };
  return {
    calories: round1(after.calories - before.calories),
    proteinG: round1(after.proteinG - before.proteinG),
    fatG: round1(after.fatG - before.fatG),
    carbsG: round1(after.carbsG - before.carbsG),
    caloriesPct: pct(after.calories, before.calories),
    proteinPct: pct(after.proteinG, before.proteinG),
    fatPct: pct(after.fatG, before.fatG),
    carbsPct: pct(after.carbsG, before.carbsG),
  };
}

function dishCost(
  recipe: CatalogRecipeRef,
  products: Map<string, CatalogProductRef>,
  scale: number,
): { consumed: number | null; packages: number | null; incomplete: boolean } {
  const lines = recipe.ingredients.map((ing) => {
    const product = products.get(ing.productId);
    if (!product) {
      return {
        productId: ing.productId,
        displayName: 'unknown',
        consumedCostRub: null,
        packageCostRub: null,
        priceStatus: 'missing' as const,
      };
    }
    const grams = ing.amount * scale;
    return costForIngredient({
      productId: product.productId,
      displayName: product.displayName,
      amount: grams,
      unit: ing.unit,
      packageSize: product.packageSize,
      packageUnit: product.packageUnit,
      packagePriceRub: product.unitPriceRub,
    });
  });
  const summary = summarizeDishCost(lines);
  return {
    consumed: summary.consumedCostRub,
    packages: summary.packageCostRub,
    incomplete: !summary.complete,
  };
}

export function buildDishCandidates(input: {
  sourceRecipe: CatalogRecipeRef;
  sourcePortionGrams: number;
  sourceMacros: MacroTotals;
  sourceCost: { consumed: number | null; packages: number | null };
  mealType: string;
  dayTargetCalories: number;
  dayOtherCalories: number;
  recipes: CatalogRecipeRef[];
  products: Map<string, CatalogProductRef>;
  constraints: UserDietConstraints;
}): { candidates: SubstitutionCandidate[]; blockedCount: number } {
  const candidates: SubstitutionCandidate[] = [];
  let blockedCount = 0;

  for (const recipe of input.recipes) {
    const filter = hardFilterRecipe({
      recipe,
      products: input.products,
      constraints: input.constraints,
      mealType: input.mealType,
      sourceRecipeId: input.sourceRecipe.recipeId,
      canScale: true,
    });
    if (!filter.allowed) {
      blockedCount += 1;
      continue;
    }

    const baseMacros = recipeMacros(recipe, input.products, 1);
    if (!baseMacros) {
      blockedCount += 1;
      continue;
    }

    const portion = suggestPortion({
      sourceMacros: input.sourceMacros,
      candidateBaseMacros: baseMacros,
      candidateBasePortionGrams: recipe.portionGrams,
      originalPortionGrams: input.sourcePortionGrams,
    });

    const classed = classifySubstitution({
      source: input.sourceMacros,
      candidate: portion.macros,
      requiresOtherMealAdjust: Math.abs(portion.calorieDelta) > input.dayTargetCalories * 0.08,
    });

    const cost = dishCost(recipe, input.products, portion.scale);
    const costDelta =
      input.sourceCost.consumed != null && cost.consumed != null
        ? Math.round((cost.consumed - input.sourceCost.consumed) * 100) / 100
        : null;

    const candidate: SubstitutionCandidate = {
      candidateId: `dish:${recipe.recipeId}`,
      candidateType: 'REPLACE_DISH',
      recipeId: recipe.recipeId,
      productId: null,
      name: recipe.name,
      suggestedPortionGrams: portion.suggestedPortionGrams,
      originalPortionGrams: input.sourcePortionGrams,
      calories: portion.macros.calories,
      proteinG: portion.macros.proteinG,
      fatG: portion.macros.fatG,
      carbsG: portion.macros.carbsG,
      nutrientDelta: macroDelta(portion.macros, input.sourceMacros),
      costDeltaRub: costDelta,
      consumedCostRub: cost.consumed,
      packageCostRub: cost.packages,
      preparationMinutes: recipe.prepMinutes + recipe.cookMinutes,
      dietaryTags: recipe.dietaryTags,
      classification: classed.classification,
      reasons: classed.reasons,
      warnings: classed.warnings,
      compensationOptions: classed.compensationOptions,
    };

    const dayGap =
      input.dayOtherCalories + portion.macros.calories - input.dayTargetCalories;
    const score = rankScore({
      candidate,
      sourcePrepMinutes: input.sourceRecipe.prepMinutes + input.sourceRecipe.cookMinutes,
      ingredientProductIds: recipe.ingredients.map((i) => i.productId),
      constraints: input.constraints,
      dayCalorieGapAfter: dayGap,
    });
    (candidate as SubstitutionCandidate & { _score?: number })._score = score;
    candidates.push(candidate);
  }

  return {
    candidates: sortCandidatesStable(candidates, (c) => (c as SubstitutionCandidate & { _score?: number })._score ?? 0),
    blockedCount,
  };
}

export type CuratedSubstitutionHint = {
  replacementProductId: string;
  culinaryRoleId?: string | null;
  culinaryRoleCode: string | null;
  replacementRatio: number;
  replacementRatioMin: number;
  replacementRatioMax: number;
  nutritionImpact: string;
  textureImpact: string;
  supportedMethods: string[];
  status?: string;
  sourceProductId?: string;
};

export type CuratedEligibilityEdge = CuratedSubstitutionHint & SubstitutionEligibilityEdge;

export function buildIngredientCandidates(input: {
  sourceRecipe: CatalogRecipeRef;
  sourcePortionGrams: number;
  sourceMacros: MacroTotals;
  sourceCost: { consumed: number | null };
  replaceProductId: string;
  mealType: string;
  dayTargetCalories: number;
  dayOtherCalories: number;
  products: Map<string, CatalogProductRef>;
  constraints: UserDietConstraints;
  /**
   * Curated edges for eligibility (may include method-incompatible ACTIVE and inactive).
   * Prefer this over curatedSubstitutions so heuristic cannot bypass METHOD_INCOMPATIBLE.
   */
  curatedEdges?: CuratedEligibilityEdge[];
  /** @deprecated Prefer curatedEdges; treated as ACTIVE compatible hints when curatedEdges omitted. */
  curatedSubstitutions?: CuratedSubstitutionHint[];
  cookingMethod?: string | null;
  cookingMethods?: string[] | null;
  culinaryRoleId?: string | null;
}): { candidates: SubstitutionCandidate[]; blockedCount: number } {
  const replaceIng = input.sourceRecipe.ingredients.find((i) => i.productId === input.replaceProductId);
  if (!replaceIng) return { candidates: [], blockedCount: 0 };

  const otherIngs = input.sourceRecipe.ingredients.filter((i) => i.productId !== input.replaceProductId);
  const otherMacros = sumMacros(
    otherIngs.map((ing) => {
      const product = input.products.get(ing.productId)!;
      return macrosFromIngredient({
        amount: ing.amount,
        unit: ing.unit,
        caloriesPer100g: product.caloriesPer100g,
        proteinPer100g: product.proteinPer100g,
        fatPer100g: product.fatPer100g,
        carbsPer100g: product.carbsPer100g,
      });
    }),
  );

  const candidates: SubstitutionCandidate[] = [];
  let blockedCount = 0;
  const cookingMethods = [
    ...new Set(
      [...(input.cookingMethods ?? []), input.cookingMethod].filter((m): m is string => Boolean(m)),
    ),
  ];

  const eligibilityEdges: CuratedEligibilityEdge[] =
    input.curatedEdges ??
    (input.curatedSubstitutions ?? []).map((edge) => ({
      ...edge,
      sourceProductId: edge.sourceProductId ?? input.replaceProductId,
      replacementProductId: edge.replacementProductId,
      culinaryRoleId: edge.culinaryRoleId ?? null,
      status: edge.status ?? 'ACTIVE',
      supportedMethods: edge.supportedMethods,
    }));

  const seenProductIds = new Set<string>();

  const pushCandidate = (
    product: CatalogProductRef,
    provenance: 'CURATED_PRODUCT_SUBSTITUTION' | 'HEURISTIC_CATALOG_MATCH',
    curated?: CuratedSubstitutionHint,
  ) => {
    const filter = hardFilterIngredientProduct({
      product,
      constraints: input.constraints,
      sourceProductId: input.replaceProductId,
    });
    if (!filter.allowed) {
      blockedCount += 1;
      return;
    }

    const minGrams = curated
      ? Math.max(1, Math.round(replaceIng.amount * curated.replacementRatioMin))
      : undefined;
    const maxGrams = curated
      ? Math.max(minGrams ?? 1, Math.round(replaceIng.amount * curated.replacementRatioMax))
      : undefined;

    let suggestion = suggestIngredientAmountWithMacros({
      otherMacros,
      sourceDishMacros: input.sourceMacros,
      replacement: product,
      minGrams,
      maxGrams,
    });

    let baseRatio: number | null = null;
    let adjustedRatio: number | null = null;
    let ratioReason: string | null = null;
    if (curated) {
      baseRatio = curated.replacementRatio;
      const technological = replaceIng.amount * curated.replacementRatio;
      // Prefer macro-scaled amount; clamp into curated bounds.
      let amount = suggestion.amountGrams;
      let reason = 'PORTION_SCALED_WITHIN_RATIO_BOUNDS';
      if (amount < (minGrams ?? amount)) {
        amount = minGrams!;
        reason = 'CLAMPED_TO_RATIO_MIN';
      } else if (amount > (maxGrams ?? amount)) {
        amount = maxGrams!;
        reason = 'CLAMPED_TO_RATIO_MAX';
      }
      // Seed with technological baseline when macro scale is wildly off.
      if (Math.abs(amount - technological) / Math.max(technological, 1) > 0.5) {
        amount = Math.round(
          Math.min(maxGrams ?? technological, Math.max(minGrams ?? technological, technological)),
        );
        reason = 'TECHNOLOGICAL_RATIO_BASELINE';
        const factor = amount / 100;
        suggestion = {
          amountGrams: amount,
          dishMacros: {
            calories: round1(otherMacros.calories + product.caloriesPer100g * factor),
            proteinG: round1(otherMacros.proteinG + product.proteinPer100g * factor),
            fatG: round1(otherMacros.fatG + product.fatPer100g * factor),
            carbsG: round1(otherMacros.carbsG + product.carbsPer100g * factor),
          },
        };
      } else {
        suggestion = { ...suggestion, amountGrams: amount };
      }
      adjustedRatio = amount / Math.max(replaceIng.amount, 1);
      ratioReason = reason;
    }

    const classed = classifySubstitution({
      source: input.sourceMacros,
      candidate: suggestion.dishMacros,
      requiresOtherMealAdjust: false,
    });

    const line = costForIngredient({
      productId: product.productId,
      displayName: product.displayName,
      amount: suggestion.amountGrams,
      unit: product.unit === 'ml' ? 'ml' : 'g',
      packageSize: product.packageSize,
      packageUnit: product.packageUnit,
      packagePriceRub: product.unitPriceRub,
    });
    const costDelta =
      input.sourceCost.consumed != null && line.consumedCostRub != null
        ? Math.round((line.consumedCostRub - input.sourceCost.consumed) * 100) / 100
        : null;

    const provenanceLabel =
      provenance === 'CURATED_PRODUCT_SUBSTITUTION'
        ? 'Curated ProductSubstitution'
        : 'Heuristic catalog match';
    const roleLabel = curated?.culinaryRoleCode ? ` роль ${curated.culinaryRoleCode}` : '';
    const candidate: SubstitutionCandidate = {
      candidateId: `ingredient:${input.replaceProductId}->${product.productId}:${suggestion.amountGrams}`,
      candidateType: 'REPLACE_INGREDIENT',
      recipeId: input.sourceRecipe.recipeId,
      productId: product.productId,
      name: `${product.displayName} вместо ингредиента`,
      suggestedPortionGrams: input.sourcePortionGrams,
      originalPortionGrams: input.sourcePortionGrams,
      calories: suggestion.dishMacros.calories,
      proteinG: suggestion.dishMacros.proteinG,
      fatG: suggestion.dishMacros.fatG,
      carbsG: suggestion.dishMacros.carbsG,
      nutrientDelta: macroDelta(suggestion.dishMacros, input.sourceMacros),
      costDeltaRub: costDelta,
      consumedCostRub: line.consumedCostRub,
      packageCostRub: line.packageCostRub,
      preparationMinutes: input.sourceRecipe.prepMinutes + input.sourceRecipe.cookMinutes,
      dietaryTags: product.dietaryTags,
      classification: classed.classification,
      reasons: [
        ...classed.reasons,
        `${provenanceLabel}${roleLabel}.`,
        `Рекомендуемая граммовка замены: ${suggestion.amountGrams} ${product.unit}.`,
        ...(curated?.textureImpact && curated.textureImpact !== 'UNKNOWN'
          ? [`Texture impact: ${curated.textureImpact}.`]
          : []),
        ...(curated?.supportedMethods?.length
          ? [`Cooking methods: ${curated.supportedMethods.join(', ')}.`]
          : []),
      ],
      warnings: classed.warnings,
      compensationOptions: classed.compensationOptions,
      provenance,
      culinaryRoleCode: curated?.culinaryRoleCode ?? null,
      nutritionImpact: curated?.nutritionImpact ?? null,
      textureImpact: curated?.textureImpact ?? null,
      supportedMethods: curated?.supportedMethods ?? [],
      baseRatio,
      adjustedRatio,
      ratioReason,
      suggestedAmountGrams: suggestion.amountGrams,
    };

    const dayGap = input.dayOtherCalories + suggestion.dishMacros.calories - input.dayTargetCalories;
    let score = rankScore({
      candidate,
      sourcePrepMinutes: input.sourceRecipe.prepMinutes + input.sourceRecipe.cookMinutes,
      ingredientProductIds: [product.productId],
      constraints: input.constraints,
      dayCalorieGapAfter: dayGap,
    });
    if (provenance === 'CURATED_PRODUCT_SUBSTITUTION') score += 25;
    (candidate as SubstitutionCandidate & { _score?: number })._score = score;
    candidates.push(candidate);
    seenProductIds.add(product.productId);
  };

  // Unified eligibility: curated-compatible first; METHOD_INCOMPATIBLE never re-enters via heuristic.
  for (const product of input.products.values()) {
    if (seenProductIds.has(product.productId)) continue;

    const eligibility = evaluateSubstitutionEligibility({
      sourceProductId: input.replaceProductId,
      replacementProductId: product.productId,
      culinaryRoleId: input.culinaryRoleId,
      cookingMethods,
      edges: eligibilityEdges,
    });

    if (eligibility === 'METHOD_INCOMPATIBLE' || eligibility === 'BLOCKED_BY_PRODUCT_POLICY') {
      blockedCount += 1;
      continue;
    }

    if (eligibility === 'CURATED_COMPATIBLE') {
      const edge = selectCompatibleCuratedEdge({
        sourceProductId: input.replaceProductId,
        replacementProductId: product.productId,
        culinaryRoleId: input.culinaryRoleId,
        cookingMethods,
        edges: eligibilityEdges,
      });
      if (!edge) {
        blockedCount += 1;
        continue;
      }
      pushCandidate(product, 'CURATED_PRODUCT_SUBSTITUTION', edge);
      continue;
    }

    // NO_CURATED_RULE | INACTIVE_ONLY → heuristic fallback (hard filters still apply).
    pushCandidate(product, 'HEURISTIC_CATALOG_MATCH');
  }

  return {
    candidates: sortCandidatesStable(candidates, (c) => (c as SubstitutionCandidate & { _score?: number })._score ?? 0),
    blockedCount,
  };
}

export function parseCandidateId(candidateId: string): {
  kind: SubstitutionKind;
  recipeId?: string;
  fromProductId?: string;
  toProductId?: string;
  amountGrams?: number;
} {
  if (candidateId.startsWith('dish:')) {
    return { kind: 'REPLACE_DISH', recipeId: candidateId.slice(5) };
  }
  const m = /^ingredient:([^>]+)->([^:]+):(\d+(?:\.\d+)?)$/.exec(candidateId);
  if (!m) throw new Error('SUBSTITUTION_CANDIDATE_INVALID');
  return {
    kind: 'REPLACE_INGREDIENT',
    fromProductId: m[1],
    toProductId: m[2],
    amountGrams: Number(m[3]),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
