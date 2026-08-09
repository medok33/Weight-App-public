import { describe, expect, it } from 'vitest';
import {
  assertCategoryHierarchyAcyclic,
  assertDietaryTagConflict,
  assertProductForm,
  convertToGrams,
  legacyAllergenToCode,
  normalizeProductAlias,
  validateDensity,
  validateEdiblePartPercent,
  validateNutritionValues,
  validateYieldCoefficient,
} from '../domain/product-foundation.policy';

describe('RP2-01A product foundation policy', () => {
  it('normalizes aliases with ё→е, punctuation, and spaces', () => {
    expect(normalizeProductAlias('  Куриная   Грудка!!! ')).toBe('куриная грудка');
    expect(normalizeProductAlias('чёрный хлеб')).toBe('черный хлеб');
    expect(normalizeProductAlias('филе-грудки')).toBe('филе грудки');
  });

  it('rejects empty alias after normalization', () => {
    expect(() => normalizeProductAlias('   !!!  ')).toThrow('PRODUCT_ALIAS_INVALID');
  });

  it('validates product forms and rejects free text', () => {
    expect(assertProductForm('RAW')).toBe('RAW');
    expect(assertProductForm('BOILED')).toBe('BOILED');
    expect(() => assertProductForm('варёный')).toThrow('PRODUCT_FORM_INVALID');
  });

  it('validates edible/density/yield coefficients', () => {
    expect(() => validateEdiblePartPercent(0)).toThrow();
    expect(() => validateEdiblePartPercent(101)).toThrow();
    validateEdiblePartPercent(85);
    expect(() => validateDensity(0)).toThrow();
    validateDensity(1.03);
    expect(() => validateYieldCoefficient(-1)).toThrow();
    validateYieldCoefficient(1.2);
  });

  it('rejects category self-parent and cycles', () => {
    const cats = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ];
    expect(() => assertCategoryHierarchyAcyclic(cats, 'a', 'a')).toThrow('PRODUCT_CATEGORY_SELF_PARENT');
    expect(() => assertCategoryHierarchyAcyclic(cats, 'a', 'c')).toThrow('PRODUCT_CATEGORY_CYCLE');
    expect(() => assertCategoryHierarchyAcyclic(cats, 'd', 'c')).not.toThrow();
  });

  it('does not guess unit conversion without coefficients', () => {
    expect(convertToGrams({ amount: 100, unit: 'g' })).toEqual({ ok: true, grams: 100 });
    expect(convertToGrams({ amount: 2, unit: 'ml' })).toEqual({ ok: false, reason: 'CONVERSION_UNAVAILABLE' });
    expect(convertToGrams({ amount: 2, unit: 'ml', density: 1.0 })).toEqual({ ok: true, grams: 2 });
    expect(convertToGrams({ amount: 1, unit: 'piece' })).toEqual({ ok: false, reason: 'CONVERSION_UNAVAILABLE' });
    expect(convertToGrams({ amount: 2, unit: 'piece', averagePieceWeightGrams: 50 })).toEqual({
      ok: true,
      grams: 100,
    });
  });

  it('maps allergen codes to STEP_093 legacy tokens', () => {
    expect(legacyAllergenToCode('dairy')).toBe('milk');
    expect(legacyAllergenToCode('egg')).toBe('eggs');
    expect(legacyAllergenToCode('peanut')).toBe('peanuts');
  });

  it('validates nutrition and dietary conflicts', () => {
    expect(() => validateNutritionValues({ calories: -1, protein: 0, fat: 0, carbohydrate: 0 })).toThrow();
    validateNutritionValues({ calories: 100, protein: 10, fat: 1, carbohydrate: 12 });
    expect(() => assertDietaryTagConflict(['vegan', 'pescatarian'])).toThrow('PRODUCT_DIETARY_TAG_CONFLICT');
  });
});
