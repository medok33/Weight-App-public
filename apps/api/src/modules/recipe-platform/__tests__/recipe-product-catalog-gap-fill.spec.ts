import { describe, expect, it } from 'vitest';
import { buildCsv, classifyGapName, normalizeGapName } from '../../../../scripts/recipe-product-catalog-gap-fill-01.ts';
import { CATALOG_CORE_V3_PRODUCTS } from '../../product-catalog/seed/catalog-core-v3.dataset.ts';

describe('recipe product catalog gap fill', () => {
  it('normalizes only safe source noise and preserves semantic qualifiers', () => {
    expect(normalizeGapName('Орегано,  щепотка')).toBe('орегано');
    expect(classifyGapName('Орегано,  щепотка')).toBe('SOURCE_NOISE');
    expect(classifyGapName('Масло растительное (сливочное)')).toBe('AMBIGUOUS_CATALOG_SEMANTICS');
    expect(classifyGapName('Помидоры черри')).toBe('REAL_MISSING_PRODUCT');
  });

  it('round-trips the machine CSV schema with quoted values', () => {
    const header = ['originalIngredient', 'newGapClass', 'resolutionReason'] as const;
    const csv = buildCsv(header, [{ originalIngredient: 'Твёрдый сыр', newGapClass: 'EXISTING_PRODUCT_NORMALIZATION_GAP', resolutionReason: 'word order, "safe" alias' }], (row) => header.map((key) => row[key]));
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(header.join(','));
    expect(lines[1]).toContain('"word order, ""safe"" alias"');
    expect(lines).toHaveLength(2);
  });

  it('requires local nutrition authority and unique product/alias identities for bounded additions', () => {
    const additions = CATALOG_CORE_V3_PRODUCTS.filter((product) => ['tomato_raw', 'egg_raw', 'chicken_breast_raw', 'round_rice_dry', 'parmesan_hard', 'romaine_lettuce_raw', 'iceberg_lettuce_raw', 'bread_crumbs_dry', 'capers_pickled'].includes(product.productKey));
    expect(additions).toHaveLength(9);
    expect(additions.every((product) => product.nutrition?.sourceRecordId && product.nutrition.sourceRef === 'USDA_FDC')).toBe(true);
    expect(new Set(additions.map((product) => product.productKey)).size).toBe(additions.length);
    const aliases = additions.flatMap((product) => (product.aliases ?? []).map((alias) => alias.alias));
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});
