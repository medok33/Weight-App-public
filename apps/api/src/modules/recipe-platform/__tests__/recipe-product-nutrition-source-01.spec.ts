import { describe, expect, it } from 'vitest';
import {
  NUTRITION_EVIDENCE,
  buildEvidenceCsv,
  energySanityPass,
  isPer100gValid,
  normalizeNutritionIdentity,
} from '../../../../scripts/recipe-product-nutrition-source-01.ts';

describe('RECIPE-PRODUCT-NUTRITION-SOURCE-01', () => {
  it('reconciles the 13 remaining identities and keeps every decision explicit', () => {
    expect(NUTRITION_EVIDENCE).toHaveLength(13);
    expect(NUTRITION_EVIDENCE.filter((row) => row.decision === 'AUTHORITATIVE_PRODUCT_READY')).toHaveLength(0);
    expect(NUTRITION_EVIDENCE.filter((row) => row.decision === 'EXISTING_PRODUCT_FOUND')).toHaveLength(1);
    expect(NUTRITION_EVIDENCE.filter((row) => row.decision === 'GENERIC_UNBOUNDED_IDENTITY')).toHaveLength(1);
    expect(NUTRITION_EVIDENCE.filter((row) => row.decision === 'OUT_OF_SCOPE_PACKAGED_PRODUCT')).toHaveLength(1);
  });

  it('normalizes vanilla sugar aliases without creating a composite nutrition value', () => {
    expect(normalizeNutritionIdentity('Сахар ванильный')).toBe('сахар ванильный');
    expect(normalizeNutritionIdentity('ванильный сахар')).toBe('ванильный сахар');
    expect(NUTRITION_EVIDENCE.filter((row) => /ванильный сахар|сахар ванильный/.test(row.normalizedIngredient)).every((row) => row.decision === 'PRODUCT_NUTRITION_AUTHORITY_MISSING')).toBe(true);
  });

  it('rejects cross-form substitutions and zero-calorie trace assumptions', () => {
    expect(NUTRITION_EVIDENCE.find((row) => row.normalizedIngredient === 'помидоры черри')?.decision).toBe('AMBIGUOUS_FORM');
    expect(NUTRITION_EVIDENCE.find((row) => row.normalizedIngredient === 'тушенка')?.decision).toBe('OUT_OF_SCOPE_PACKAGED_PRODUCT');
    expect(NUTRITION_EVIDENCE.find((row) => row.normalizedIngredient === 'ванилин')?.decision).toBe('PRODUCT_NUTRITION_AUTHORITY_MISSING');
  });

  it('validates per-100g numeric fields and energy sanity independently', () => {
    expect(isPer100gValid({ energyKcalPer100g: '100', proteinGPer100g: '4', fatGPer100g: '2', carbGPer100g: '12' })).toBe(true);
    expect(isPer100gValid({ energyKcalPer100g: '-1', proteinGPer100g: '', fatGPer100g: '', carbGPer100g: '' })).toBe(false);
    expect(energySanityPass(100, 4, 2, 12)).toBe(true);
    expect(energySanityPass(900, 4, 2, 12)).toBe(false);
  });

  it('does not duplicate identities or nutrition rows and emits provenance columns', () => {
    const identities = NUTRITION_EVIDENCE.map((row) => row.normalizedIngredient);
    expect(new Set(identities).size).toBe(identities.length);
    const csv = buildEvidenceCsv();
    expect(csv.split('\n')[0]).toContain('authorityRecordId');
    expect(csv).toContain('USDA_FDC_MAP:butter_72pct:2026-07-25');
    expect(csv).not.toContain('DONOR');
  });
});
