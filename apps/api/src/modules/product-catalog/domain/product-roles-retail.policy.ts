import {
  COOKING_METHOD_CODES,
  CULINARY_ROLE_CODES,
  NUTRITION_IMPACTS,
  SUBSTITUTION_STATUSES,
  TEXTURE_IMPACTS,
  type CookingMethodCode,
  type CulinaryRoleCode,
  type NutritionImpact,
  type RatioResolution,
  type SubstitutionEligibility,
  type SubstitutionEligibilityEdge,
  type SubstitutionStatus,
  type TextureImpact,
} from './product-roles-retail.types';

export function assertCulinaryRoleCode(code: string): CulinaryRoleCode {
  if (!(CULINARY_ROLE_CODES as readonly string[]).includes(code)) {
    throw new Error('CULINARY_ROLE_INVALID');
  }
  return code as CulinaryRoleCode;
}

export function assertCookingMethodCode(code: string): CookingMethodCode {
  if (!(COOKING_METHOD_CODES as readonly string[]).includes(code)) {
    throw new Error('COOKING_METHOD_INVALID');
  }
  return code as CookingMethodCode;
}

export function assertSubstitutionStatus(status: string): SubstitutionStatus {
  if (!(SUBSTITUTION_STATUSES as readonly string[]).includes(status)) {
    throw new Error('PRODUCT_SUBSTITUTION_STATUS_INVALID');
  }
  return status as SubstitutionStatus;
}

export function assertNutritionImpact(value: string): NutritionImpact {
  if (!(NUTRITION_IMPACTS as readonly string[]).includes(value)) {
    throw new Error('NUTRITION_IMPACT_INVALID');
  }
  return value as NutritionImpact;
}

export function assertTextureImpact(value: string): TextureImpact {
  if (!(TEXTURE_IMPACTS as readonly string[]).includes(value)) {
    throw new Error('TEXTURE_IMPACT_INVALID');
  }
  return value as TextureImpact;
}

export function validateSubstitutionEdge(input: {
  sourceProductId: string;
  replacementProductId: string;
  replacementRatio: number;
  replacementRatioMin: number;
  replacementRatioMax: number;
}): void {
  if (!input.sourceProductId || !input.replacementProductId) {
    throw new Error('PRODUCT_SUBSTITUTION_PRODUCT_REQUIRED');
  }
  if (input.sourceProductId === input.replacementProductId) {
    throw new Error('PRODUCT_SUBSTITUTION_SELF_EDGE');
  }
  if (!(input.replacementRatio > 0)) throw new Error('PRODUCT_SUBSTITUTION_RATIO_INVALID');
  if (!(input.replacementRatioMin > 0)) throw new Error('PRODUCT_SUBSTITUTION_RATIO_MIN_INVALID');
  if (!(input.replacementRatioMax > 0)) throw new Error('PRODUCT_SUBSTITUTION_RATIO_MAX_INVALID');
  if (
    input.replacementRatioMin > input.replacementRatio ||
    input.replacementRatio > input.replacementRatioMax
  ) {
    throw new Error('PRODUCT_SUBSTITUTION_RATIO_BOUNDS');
  }
}

export function validateRetailPackage(input: {
  packageWeight?: number | null;
  packageQuantity?: number | null;
}): void {
  if (input.packageWeight != null && !(input.packageWeight > 0)) {
    throw new Error('RETAIL_PRODUCT_PACKAGE_WEIGHT_INVALID');
  }
  if (input.packageQuantity != null && !(input.packageQuantity > 0)) {
    throw new Error('RETAIL_PRODUCT_PACKAGE_QUANTITY_INVALID');
  }
}

/**
 * Apply curated ratio as technological baseline, then clamp portion scaling into min/max mass.
 * Does not invent calories — caller supplies after-macros for delta reporting.
 */
export function resolveReplacementRatio(input: {
  sourceAmount: number;
  baseRatio: number;
  ratioMin: number;
  ratioMax: number;
  /** Amount after STEP_093 macro portion scaling (grams/ml). */
  scaledAmount: number;
  beforeMacros: { calories: number; proteinG: number; fatG: number; carbsG: number };
  afterMacros: { calories: number; proteinG: number; fatG: number; carbsG: number };
}): RatioResolution {
  if (!(input.sourceAmount > 0)) throw new Error('PRODUCT_SUBSTITUTION_SOURCE_AMOUNT_INVALID');
  if (!(input.baseRatio > 0)) throw new Error('PRODUCT_SUBSTITUTION_RATIO_INVALID');

  const technological = input.sourceAmount * input.baseRatio;
  const minAmount = input.sourceAmount * input.ratioMin;
  const maxAmount = input.sourceAmount * input.ratioMax;
  let suggested = input.scaledAmount;
  let reason = 'PORTION_SCALED_WITHIN_RATIO_BOUNDS';

  // If macro scaling drifted far from technological baseline, reseat then clamp.
  if (Math.abs(suggested - technological) / Math.max(technological, 1) > 0.5) {
    suggested = technological;
    reason = 'TECHNOLOGICAL_RATIO_BASELINE';
  }

  if (suggested < minAmount) {
    suggested = minAmount;
    reason = 'CLAMPED_TO_RATIO_MIN';
  } else if (suggested > maxAmount) {
    suggested = maxAmount;
    reason = 'CLAMPED_TO_RATIO_MAX';
  }

  // Reject unrealistic masses (>20× source or <1g when source ≥5g).
  if (suggested > input.sourceAmount * 20 || (input.sourceAmount >= 5 && suggested < 1)) {
    throw new Error('PRODUCT_SUBSTITUTION_AMOUNT_UNREALISTIC');
  }

  const adjustedRatio = suggested / input.sourceAmount;
  return {
    baseRatio: input.baseRatio,
    adjustedRatio: round6(adjustedRatio),
    suggestedAmount: round1(suggested),
    sourceAmount: input.sourceAmount,
    ratioReason: reason,
    nutritionalDelta: {
      calories: round1(input.afterMacros.calories - input.beforeMacros.calories),
      proteinG: round1(input.afterMacros.proteinG - input.beforeMacros.proteinG),
      fatG: round1(input.afterMacros.fatG - input.beforeMacros.fatG),
      carbsG: round1(input.afterMacros.carbsG - input.beforeMacros.carbsG),
    },
  };
}

export function methodCompatible(
  supportedMethods: readonly string[],
  cookingMethod: string | null | undefined,
): boolean {
  if (!cookingMethod) return true; // unknown method → do not hard-block curated edges
  if (!supportedMethods.length) return true;
  return supportedMethods.includes(cookingMethod);
}

/** Edge is compatible when any recipe method intersects supportedMethods (empty either side → allow). */
export function edgeCompatibleWithCookingMethods(
  supportedMethods: readonly string[],
  cookingMethods: readonly string[],
): boolean {
  if (!cookingMethods.length) return true;
  if (!supportedMethods.length) return true;
  return cookingMethods.some((m) => methodCompatible(supportedMethods, m));
}

function edgeAppliesToRole(
  edge: SubstitutionEligibilityEdge,
  culinaryRoleId: string | null | undefined,
): boolean {
  if (culinaryRoleId == null || culinaryRoleId === '') return true;
  if (edge.culinaryRoleId == null) return true;
  return edge.culinaryRoleId === culinaryRoleId;
}

/**
 * Single eligibility decision for source → replacement under role + cooking context.
 * Used by STEP_093 when merging curated + heuristic candidates so method-incompatible
 * curated pairs cannot re-enter via HEURISTIC_CATALOG_MATCH.
 */
export function evaluateSubstitutionEligibility(input: {
  sourceProductId: string;
  replacementProductId: string;
  culinaryRoleId?: string | null;
  cookingMethods?: readonly string[] | null;
  edges: readonly SubstitutionEligibilityEdge[];
  /** Optional hard product-policy block (allergen/exclusion handled elsewhere usually). */
  blockedByProductPolicy?: boolean;
}): SubstitutionEligibility {
  if (input.blockedByProductPolicy) return 'BLOCKED_BY_PRODUCT_POLICY';
  if (input.sourceProductId === input.replacementProductId) return 'BLOCKED_BY_PRODUCT_POLICY';

  const allPairEdges = input.edges.filter(
    (e) =>
      e.sourceProductId === input.sourceProductId &&
      e.replacementProductId === input.replacementProductId,
  );
  const pairEdges = allPairEdges.filter((e) => edgeAppliesToRole(e, input.culinaryRoleId));
  if (!pairEdges.length) {
    // Role mismatch must not reopen a method-incompatible curated pair via heuristic.
    const activeAll = allPairEdges.filter((e) => e.status === 'ACTIVE');
    if (activeAll.length) {
      const methods = [...new Set((input.cookingMethods ?? []).filter(Boolean))];
      if (
        methods.length &&
        !activeAll.some((e) => edgeCompatibleWithCookingMethods(e.supportedMethods, methods))
      ) {
        return 'METHOD_INCOMPATIBLE';
      }
    }
    return 'NO_CURATED_RULE';
  }

  const active = pairEdges.filter((e) => e.status === 'ACTIVE');
  if (!active.length) return 'INACTIVE_ONLY';

  const cookingMethods = [...new Set((input.cookingMethods ?? []).filter(Boolean))];
  const compatible = active.filter((e) =>
    edgeCompatibleWithCookingMethods(e.supportedMethods, cookingMethods),
  );
  if (compatible.length) return 'CURATED_COMPATIBLE';
  return 'METHOD_INCOMPATIBLE';
}

/** Prefer first ACTIVE method-compatible edge; order must not change eligibility. */
export function selectCompatibleCuratedEdge<T extends SubstitutionEligibilityEdge>(input: {
  sourceProductId: string;
  replacementProductId: string;
  culinaryRoleId?: string | null;
  cookingMethods?: readonly string[] | null;
  edges: readonly T[];
}): T | null {
  const cookingMethods = [...new Set((input.cookingMethods ?? []).filter(Boolean))];
  const matches = input.edges.filter(
    (e) =>
      e.sourceProductId === input.sourceProductId &&
      e.replacementProductId === input.replacementProductId &&
      e.status === 'ACTIVE' &&
      edgeAppliesToRole(e, input.culinaryRoleId) &&
      edgeCompatibleWithCookingMethods(e.supportedMethods, cookingMethods),
  );
  return matches[0] ?? null;
}

export function inferCookingMethodsFromRecipeText(input: {
  description?: string | null;
  stepInstructions?: string[];
}): CookingMethodCode[] {
  const text = `${input.description ?? ''} ${(input.stepInstructions ?? []).join(' ')}`.toLowerCase();
  const found = new Set<CookingMethodCode>();
  if (/отвар|кипят|варк|boil/.test(text)) found.add('BOIL');
  if (/запек|духов|bake/.test(text)) found.add('BAKE');
  if (/обжар|жарк|сковород|fry/.test(text)) found.add('FRY');
  if (/туш|stew/.test(text)) found.add('STEW');
  if (/пар|steam/.test(text)) found.add('STEAM');
  if (/гриль|grill/.test(text)) found.add('GRILL');
  if (/смеш|mix/.test(text)) found.add('MIX');
  if (/бленд|измельч|blend/.test(text)) found.add('BLEND');
  if (!found.size && /сыр|raw/.test(text)) found.add('RAW');
  return [...found];
}

/** Prefer FRY/BOIL when both present (STEP_093 buckwheat+chicken). */
export function primaryCookingMethod(methods: CookingMethodCode[]): CookingMethodCode | null {
  if (!methods.length) return null;
  const prefer: CookingMethodCode[] = ['FRY', 'BOIL', 'BAKE', 'STEW', 'STEAM', 'GRILL', 'MIX', 'BLEND', 'RAW'];
  for (const code of prefer) {
    if (methods.includes(code)) return code;
  }
  return methods[0] ?? null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
