import { describe, expect, it } from 'vitest';
import { resolveIngredientGrams } from '../domain/recipe-grammage-authority.policy';

const authority = { id: 'test-density', version: 'v1', source: 'owner-approved-test-authority' };

describe('recipe grammage authority', () => {
  it('accepts exact g/kg and records source quantity', () => {
    expect(resolveIngredientGrams({ amount: 2, unit: 'kg', rawQuantity: 2, rawUnit: 'kg' })).toMatchObject({ state: 'EXACT_METRIC', grams: 2000, provenance: { rawQuantity: 2, normalizedUnit: 'kg' } });
  });
  it('converts ml/l/tbsp only with explicit density authority', () => {
    expect(resolveIngredientGrams({ amount: 2, unit: 'tbsp', density: 0.91, authority })).toMatchObject({ state: 'CONVERTED_WITH_AUTHORITY', grams: 27.3, provenance: { coefficient: 0.91, coefficientType: 'DENSITY_G_PER_ML', authority } });
    expect(resolveIngredientGrams({ amount: 2, unit: 'tbsp' }).state).toBe('BLOCKED_MISSING_AUTHORITY');
    expect(resolveIngredientGrams({ amount: 1, unit: 'ml', density: Number.NaN, authority }).state).toBe('BLOCKED_MISSING_AUTHORITY');
  });
  it('converts pieces only with explicit mass-per-piece authority', () => {
    expect(resolveIngredientGrams({ amount: 3, unit: 'piece', averagePieceWeightGrams: 50, authority })).toMatchObject({ state: 'CONVERTED_WITH_AUTHORITY', grams: 150, provenance: { coefficientType: 'MASS_PER_PIECE' } });
    expect(resolveIngredientGrams({ amount: 3, unit: 'piece' }).state).toBe('BLOCKED_MISSING_AUTHORITY');
  });
  it('fails closed for unknown/invalid values and does not use factor one', () => {
    expect(resolveIngredientGrams({ amount: 1, unit: 'unknown' }).state).toBe('BLOCKED_INVALID_INPUT');
    expect(resolveIngredientGrams({ amount: 0, unit: 'g' }).state).toBe('BLOCKED_INVALID_INPUT');
    expect(resolveIngredientGrams({ amount: 1, unit: 'ml', density: Number.POSITIVE_INFINITY, authority }).state).toBe('BLOCKED_MISSING_AUTHORITY');
  });
  it('tracks optional/process inputs without inventing grams', () => {
    expect(resolveIngredientGrams({ amount: null, unit: null, optional: true })).toMatchObject({ state: 'EXCLUDED_OPTIONAL', grams: null });
    expect(resolveIngredientGrams({ amount: null, unit: null, processInput: true })).toMatchObject({ state: 'PROCESS_INPUT_TRACKED', grams: null });
  });
});
