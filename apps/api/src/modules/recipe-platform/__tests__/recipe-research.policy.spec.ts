import { describe, expect, it } from 'vitest';
import {
  assertResearchDecisionAllowed,
  assertResearchIdempotencyKey,
  computeCompleteness,
  mapIngredients,
  normalizeFoodText,
  normalizeUnit,
  parseQuantity,
  sanitizeManualPayload,
  stableJsonChecksum,
} from '../domain/recipe-research.policy';

describe('RP2-04B recipe research staging policy (STEP_216-218)', () => {
  it('allows only research-safe search decisions', () => {
    expect(() => assertResearchDecisionAllowed('RESEARCH_REQUIRED')).not.toThrow();
    expect(() => assertResearchDecisionAllowed('CREATE_FAMILY_VARIANT')).not.toThrow();
    expect(() => assertResearchDecisionAllowed('USE_EXISTING_RECIPE')).toThrow(
      /RECIPE_RESEARCH_DECISION_NOT_ALLOWED/,
    );
    expect(() => assertResearchDecisionAllowed('REVIEW_DUPLICATE')).toThrow(
      /RECIPE_RESEARCH_DECISION_NOT_ALLOWED/,
    );
    expect(() => assertResearchDecisionAllowed('REVIEW_DUPLICATE_CANDIDATES')).toThrow(
      /RECIPE_RESEARCH_DECISION_NOT_ALLOWED/,
    );
    expect(() => assertResearchDecisionAllowed('BLOCKED_NO_SAFE_ACTION')).toThrow();
  });

  it('validates idempotency keys and stable checksums', () => {
    expect(assertResearchIdempotencyKey('rp2-04b:test_key:001')).toBe('rp2-04b:test_key:001');
    expect(() => assertResearchIdempotencyKey('bad key with spaces')).toThrow(
      /RECIPE_RESEARCH_IDEMPOTENCY_KEY_INVALID/,
    );
    expect(stableJsonChecksum({ b: 2, a: 1 })).toBe(stableJsonChecksum({ a: 1, b: 2 }));
  });

  it('normalizes text, units and quantities deterministically', () => {
    expect(normalizeFoodText('  Курица Ёлка!! ')).toBe('курица елка');
    expect(parseQuantity('1/2')).toEqual({ value: 0.5, status: 'VALID' });
    expect(parseQuantity('2-4')).toEqual({ value: 3, status: 'VALID' });
    expect(parseQuantity('по вкусу')).toEqual({ value: null, status: 'MISSING' });
    expect(parseQuantity('abc')).toEqual({ value: null, status: 'INVALID' });
    expect(normalizeUnit('ч. л.')).toEqual({ unit: 'tsp', status: 'KNOWN' });
    expect(normalizeUnit('ведро')).toEqual({ unit: null, status: 'UNKNOWN' });
  });

  it('maps products through aliases without creating products', () => {
    const result = mapIngredients(
      [
        { name: 'курица', amountText: '200', unitText: 'г', notes: null },
        { name: 'неизвестный продукт', amountText: 'x', unitText: 'ведро', notes: null },
      ],
      [
        {
          productId: 'p1',
          canonicalName: 'Курица',
          name: 'Куриное филе',
          alias: 'курица',
          normalizedAlias: 'курица',
          confidence: 1,
        },
      ],
    );
    expect(result.mappings[0]).toMatchObject({
      productId: 'p1',
      matchType: 'EXACT_CANONICAL',
      quantity: 200,
      unit: 'g',
    });
    expect(result.mappings[1]?.productId).toBeNull();
    expect(result.flags.map((f) => f.type)).toEqual(
      expect.arrayContaining(['UNKNOWN_PRODUCT', 'UNKNOWN_UNIT', 'INVALID_QUANTITY']),
    );
  });

  it('sanitizes manual payload and blocks client-controlled canonical fields', () => {
    const payload = sanitizeManualPayload({
      title: 'Ручной кандидат',
      ingredients: [{ name: 'курица', amountText: '200', unitText: 'g' }],
      steps: [{ ordinal: 1, text: 'Готовить', timeMinutes: 20 }],
    });
    expect(payload.title).toBe('Ручной кандидат');
    expect(payload.externalId).toMatch(/^manual:/);
    expect(payload.warnings).toContain('MANUAL_STAGING_ONLY_NOT_RECIPE');
    expect(() =>
      sanitizeManualPayload({
        title: 'x',
        ingredients: [{ name: 'x' }],
        steps: [{ text: 'x' }],
        recipeId: 'canonical-mutation',
      }),
    ).toThrow(/RECIPE_RESEARCH_CLIENT_FIELD_FORBIDDEN/);
  });

  it('computes completeness without trusting source nutrition', () => {
    expect(
      computeCompleteness({
        title: 'x',
        ingredients: [{ name: 'x' }],
        steps: [{ text: 'x' }],
        servings: 2,
        preparationTime: 5,
      }),
    ).toBeGreaterThanOrEqual(0.9);
  });
});
