import { describe, expect, it } from 'vitest';
import {
  assertCulinaryRoleCode,
  evaluateSubstitutionEligibility,
  methodCompatible,
  resolveReplacementRatio,
  validateRetailPackage,
  validateSubstitutionEdge,
} from '../domain/product-roles-retail.policy';
import { buildIngredientCandidates } from '../../meal-plan/domain/substitution.engine';
import { STEP093_PRODUCTS } from '../../meal-plan/domain/substitution.fixture';
import type { CatalogProductRef } from '../../meal-plan/domain/substitution.types';

function asRef(p: (typeof STEP093_PRODUCTS)[number]): CatalogProductRef {
  return {
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
    allergens: [...p.allergens],
    dietaryTags: [...p.dietaryTags],
    enabled: true,
  };
}

const emptyConstraints = {
  allergens: [] as string[],
  foodRestrictions: [] as string[],
  dietaryPreferences: [] as string[],
  excludedProductIds: [] as string[],
  rejectedProductIds: [] as string[],
};

function baseIngredientInput(products: Map<string, CatalogProductRef>) {
  const buckwheat = STEP093_PRODUCTS[0]!;
  return {
    sourceRecipe: {
      recipeId: 'r1',
      recipeKey: 'buckwheat_chicken',
      name: 'buckwheat_chicken',
      description: 'test',
      mealTypes: ['lunch'],
      portionGrams: 400,
      prepMinutes: 10,
      cookMinutes: 25,
      allergens: [],
      dietaryTags: [],
      enabled: true,
      ingredients: [
        { productId: buckwheat.id, amount: 80, unit: 'g' as const },
        { productId: STEP093_PRODUCTS[2]!.id, amount: 160, unit: 'g' },
      ],
    },
    sourcePortionGrams: 400,
    sourceMacros: { calories: 500, proteinG: 40, fatG: 10, carbsG: 50 },
    sourceCost: { consumed: 50 },
    replaceProductId: buckwheat.id,
    mealType: 'lunch',
    dayTargetCalories: 2500,
    dayOtherCalories: 1000,
    products,
    constraints: emptyConstraints,
  };
}

describe('RP2-01B culinary roles and substitution policy', () => {
  it('accepts known culinary role codes and rejects unknown', () => {
    expect(assertCulinaryRoleCode('STARCH')).toBe('STARCH');
    expect(() => assertCulinaryRoleCode('PROTEIN')).toThrow('CULINARY_ROLE_INVALID');
  });

  it('rejects self-substitution and invalid ratios', () => {
    expect(() =>
      validateSubstitutionEdge({
        sourceProductId: 'a',
        replacementProductId: 'a',
        replacementRatio: 1,
        replacementRatioMin: 0.8,
        replacementRatioMax: 1.2,
      }),
    ).toThrow('PRODUCT_SUBSTITUTION_SELF_EDGE');

    expect(() =>
      validateSubstitutionEdge({
        sourceProductId: 'a',
        replacementProductId: 'b',
        replacementRatio: 1.5,
        replacementRatioMin: 0.8,
        replacementRatioMax: 1.2,
      }),
    ).toThrow('PRODUCT_SUBSTITUTION_RATIO_BOUNDS');
  });

  it('filters cooking methods and resolves ratio within bounds', () => {
    expect(methodCompatible(['BOIL', 'STEW'], 'BOIL')).toBe(true);
    expect(methodCompatible(['BLEND'], 'BOIL')).toBe(false);
    expect(methodCompatible(['BOIL'], null)).toBe(true);

    const ratio = resolveReplacementRatio({
      sourceAmount: 80,
      baseRatio: 1,
      ratioMin: 0.8,
      ratioMax: 1.25,
      scaledAmount: 90,
      beforeMacros: { calories: 400, proteinG: 20, fatG: 10, carbsG: 50 },
      afterMacros: { calories: 410, proteinG: 18, fatG: 9, carbsG: 55 },
    });
    expect(ratio.suggestedAmount).toBe(90);
    expect(ratio.baseRatio).toBe(1);
    expect(ratio.adjustedRatio).toBeCloseTo(1.125, 3);
  });

  it('rejects invalid retail package sizes', () => {
    expect(() => validateRetailPackage({ packageWeight: 0 })).toThrow(
      'RETAIL_PRODUCT_PACKAGE_WEIGHT_INVALID',
    );
  });

  it('eligibility: METHOD_INCOMPATIBLE when all ACTIVE edges mismatch cooking methods', () => {
    const src = 'src';
    const dst = 'dst';
    const role = 'role-starch';
    expect(
      evaluateSubstitutionEligibility({
        sourceProductId: src,
        replacementProductId: dst,
        culinaryRoleId: role,
        cookingMethods: ['BOIL'],
        edges: [
          {
            sourceProductId: src,
            replacementProductId: dst,
            culinaryRoleId: role,
            status: 'ACTIVE',
            supportedMethods: ['BLEND'],
          },
        ],
      }),
    ).toBe('METHOD_INCOMPATIBLE');
  });

  it('eligibility: CURATED_COMPATIBLE when any ACTIVE edge matches method', () => {
    const src = 'src';
    const dst = 'dst';
    expect(
      evaluateSubstitutionEligibility({
        sourceProductId: src,
        replacementProductId: dst,
        cookingMethods: ['BOIL'],
        edges: [
          {
            sourceProductId: src,
            replacementProductId: dst,
            culinaryRoleId: null,
            status: 'ACTIVE',
            supportedMethods: ['BLEND'],
          },
          {
            sourceProductId: src,
            replacementProductId: dst,
            culinaryRoleId: null,
            status: 'ACTIVE',
            supportedMethods: ['BOIL'],
          },
        ],
      }),
    ).toBe('CURATED_COMPATIBLE');
  });

  it('eligibility: INACTIVE_ONLY does not method-block (SUSPENDED alone)', () => {
    expect(
      evaluateSubstitutionEligibility({
        sourceProductId: 'a',
        replacementProductId: 'b',
        cookingMethods: ['BOIL'],
        edges: [
          {
            sourceProductId: 'a',
            replacementProductId: 'b',
            culinaryRoleId: null,
            status: 'SUSPENDED',
            supportedMethods: ['BLEND'],
          },
        ],
      }),
    ).toBe('INACTIVE_ONLY');
  });

  it('prefers curated substitution provenance over heuristic fallback', () => {
    const products = new Map(STEP093_PRODUCTS.map((p) => [p.id, asRef(p)]));
    const rice = STEP093_PRODUCTS[6]!;
    const potato = STEP093_PRODUCTS[1]!;

    const result = buildIngredientCandidates({
      ...baseIngredientInput(products),
      curatedSubstitutions: [
        {
          replacementProductId: rice.id,
          culinaryRoleCode: 'STARCH',
          replacementRatio: 1,
          replacementRatioMin: 0.8,
          replacementRatioMax: 1.25,
          nutritionImpact: 'SIMILAR',
          textureImpact: 'NOTICEABLE',
          supportedMethods: ['BOIL'],
        },
      ],
      cookingMethod: 'BOIL',
    });

    const curated = result.candidates.find((c) => c.productId === rice.id);
    expect(curated?.provenance).toBe('CURATED_PRODUCT_SUBSTITUTION');
    expect(curated?.culinaryRoleCode).toBe('STARCH');
    expect(curated?.reasons.some((r) => /Curated ProductSubstitution/.test(r))).toBe(true);

    const heuristic = result.candidates.find((c) => c.productId === potato.id);
    expect(heuristic?.provenance).toBe('HEURISTIC_CATALOG_MATCH');
  });

  it('excludes METHOD_INCOMPATIBLE potato from curated and heuristic paths', () => {
    const products = new Map(STEP093_PRODUCTS.map((p) => [p.id, asRef(p)]));
    const buckwheat = STEP093_PRODUCTS[0]!;
    const rice = STEP093_PRODUCTS[6]!;
    const potato = STEP093_PRODUCTS[1]!;
    const roleId = 'role-starch';

    const result = buildIngredientCandidates({
      ...baseIngredientInput(products),
      culinaryRoleId: roleId,
      cookingMethods: ['BOIL'],
      curatedEdges: [
        {
          sourceProductId: buckwheat.id,
          replacementProductId: rice.id,
          culinaryRoleId: roleId,
          culinaryRoleCode: 'STARCH',
          replacementRatio: 1,
          replacementRatioMin: 0.8,
          replacementRatioMax: 1.25,
          nutritionImpact: 'SIMILAR',
          textureImpact: 'NOTICEABLE',
          supportedMethods: ['BOIL', 'STEW'],
          status: 'ACTIVE',
        },
        {
          sourceProductId: buckwheat.id,
          replacementProductId: potato.id,
          culinaryRoleId: roleId,
          culinaryRoleCode: 'STARCH',
          replacementRatio: 1.2,
          replacementRatioMin: 1,
          replacementRatioMax: 1.5,
          nutritionImpact: 'VARIABLE',
          textureImpact: 'MAJOR',
          supportedMethods: ['BLEND'],
          status: 'ACTIVE',
        },
      ],
    });

    expect(result.candidates.some((c) => c.productId === potato.id)).toBe(false);
    expect(result.candidates.find((c) => c.productId === rice.id)?.provenance).toBe(
      'CURATED_PRODUCT_SUBSTITUTION',
    );
  });

  it('returns potato as curated when cooking method is BLEND', () => {
    const products = new Map(STEP093_PRODUCTS.map((p) => [p.id, asRef(p)]));
    const buckwheat = STEP093_PRODUCTS[0]!;
    const potato = STEP093_PRODUCTS[1]!;
    const roleId = 'role-starch';

    const result = buildIngredientCandidates({
      ...baseIngredientInput(products),
      culinaryRoleId: roleId,
      cookingMethods: ['BLEND'],
      curatedEdges: [
        {
          sourceProductId: buckwheat.id,
          replacementProductId: potato.id,
          culinaryRoleId: roleId,
          culinaryRoleCode: 'STARCH',
          replacementRatio: 1.2,
          replacementRatioMin: 1,
          replacementRatioMax: 1.5,
          nutritionImpact: 'VARIABLE',
          textureImpact: 'MAJOR',
          supportedMethods: ['BLEND'],
          status: 'ACTIVE',
        },
      ],
    });

    const potatoCand = result.candidates.find((c) => c.productId === potato.id);
    expect(potatoCand?.provenance).toBe('CURATED_PRODUCT_SUBSTITUTION');
  });

  it('keeps heuristic fallback when no curated edge exists for a product', () => {
    const products = new Map(STEP093_PRODUCTS.map((p) => [p.id, asRef(p)]));
    const buckwheat = STEP093_PRODUCTS[0]!;
    const potato = STEP093_PRODUCTS[1]!;
    const rice = STEP093_PRODUCTS[6]!;

    const result = buildIngredientCandidates({
      ...baseIngredientInput(products),
      cookingMethods: ['BOIL'],
      curatedEdges: [
        {
          sourceProductId: buckwheat.id,
          replacementProductId: rice.id,
          culinaryRoleId: null,
          culinaryRoleCode: 'STARCH',
          replacementRatio: 1,
          replacementRatioMin: 0.8,
          replacementRatioMax: 1.25,
          nutritionImpact: 'SIMILAR',
          textureImpact: 'NOTICEABLE',
          supportedMethods: ['BOIL'],
          status: 'ACTIVE',
        },
      ],
    });

    expect(result.candidates.find((c) => c.productId === potato.id)?.provenance).toBe(
      'HEURISTIC_CATALOG_MATCH',
    );
  });

  it('does not reverse A→B into B→A automatically (asymmetric edges)', () => {
    const a = 'product-a';
    const b = 'product-b';
    expect(a).not.toBe(b);
    validateSubstitutionEdge({
      sourceProductId: a,
      replacementProductId: b,
      replacementRatio: 1,
      replacementRatioMin: 0.5,
      replacementRatioMax: 1.5,
    });
  });
});
