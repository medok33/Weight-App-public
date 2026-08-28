import { describe, expect, it } from 'vitest';
import { applyBoundedContext, toCandidate } from '../../../../scripts/recipe-corpus-synthesis-readiness-01';
import { CATALOG_CORE_V3_PRODUCTS } from '../../product-catalog/seed/catalog-core-v3.dataset';

const accepted = CATALOG_CORE_V3_PRODUCTS.map((p) => ({ productId: p.productKey, canonicalName: p.canonicalName, aliases: (p.aliases ?? []).map((a) => a.alias) }));

describe('CONTENT-01 bounded deterministic gap decisions', () => {
  it('omits optional orange zest and resolves pilot frying oil only in recipe context', () => {
    const candidate = toCandidate({
      sourceId: 'eda', sourceRecipeId: 'tomato', title: 'Нежный омлет с помидорами',
      ingredients: [
        { rawName: 'Масло растительное (сливочное)', optional: false, normalizedQuantity: { min: 1 }, rawUnit: 'стол.л.' },
      ], steps: [{ sourceOrder: 1, researchOnlySourceText: 'Обжарьте на масле.' }],
    }, accepted);
    expect(applyBoundedContext(candidate, accepted).ingredients.map((i) => i.productId)).toContain('sunflower_oil');
    const rice = toCandidate({ sourceId: '1000menu', sourceRecipeId: 'rice', title: 'Рисовая каша с тыквой', ingredients: [{ rawName: 'Апельсиновая цедра', optional: true }], steps: [] }, accepted);
    expect(applyBoundedContext(rice, accepted).ingredients.some((i) => /цедр/.test(i.name))).toBe(false);
  });

  it('keeps generic oil and greens fail-closed outside bounded evidence context', () => {
    const candidate = toCandidate({ sourceId: '1000menu', sourceRecipeId: 'other', title: 'Обычное блюдо', ingredients: [
      { rawName: 'Масло', optional: false }, { rawName: 'Зелень', optional: false },
    ], steps: [] }, accepted);
    expect(candidate.ingredients.every((i) => i.productId == null || String(i.productId).startsWith('family:'))).toBe(true);
  });

  it('maps exact chicken mince but leaves fillet mince unresolved', () => {
    const exact = toCandidate({ sourceId: 'x', sourceRecipeId: 'cutlets', title: 'Куриные котлеты', ingredients: [{ rawName: 'Куриный фарш' }], steps: [] }, accepted);
    const ambiguous = toCandidate({ sourceId: 'x', sourceRecipeId: 'cutlets-2', title: 'Куриные котлеты', ingredients: [{ rawName: 'Фарш из филе' }], steps: [] }, accepted);
    expect(exact.ingredients[0]?.productId).toBe('chicken_mince_raw');
    expect(ambiguous.ingredients[0]?.productId).not.toBe('chicken_mince_raw');
  });

  it('retains exact USDA FDC provenance for newly added products', () => {
    const sauce = CATALOG_CORE_V3_PRODUCTS.find((p) => p.productKey === 'worcestershire_sauce');
    const beef = CATALOG_CORE_V3_PRODUCTS.find((p) => p.productKey === 'tushenka_beef_canned');
    expect(sauce?.nutrition?.sourceRecordId).toBe('USDA_FDC:171610');
    expect(beef?.nutrition?.sourceRecordId).toBe('USDA_FDC:170602');
    expect(beef?.reviewStatus).toBe('NEEDS_REVIEW');
  });
});
