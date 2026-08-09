import { describe, expect, it } from 'vitest';
import { computeProductsChecksum, withComputedChecksum } from '../checksum';
import { buildPilotManifest, PILOT_PRODUCTS } from '../pilot-v1.dataset';
import { validateManifest, validateProductRecords } from '../validate-manifest';
import type { ProductSeedRecord } from '../seed.types';
import { SEED_SCHEMA_VERSION, SEED_SOURCE_POLICY_VERSION } from '../seed.types';

describe('catalog seed manifest validation', () => {
  it('pilot manifest validates and checksum is stable', () => {
    const a = buildPilotManifest();
    const b = buildPilotManifest();
    expect(a.checksum).toBe(b.checksum);
    expect(a.productCount).toBeGreaterThanOrEqual(40);
    expect(a.productCount).toBeLessThanOrEqual(60);
    expect(validateManifest(a)).toEqual([]);
  });

  it('detects duplicate productKey and stableId', () => {
    const base = PILOT_PRODUCTS[0]!;
    const dupKey: ProductSeedRecord = { ...base, stableId: 'c2010001-0000-4000-8000-ffffffffffff' };
    const dupId: ProductSeedRecord = {
      ...PILOT_PRODUCTS[1]!,
      stableId: base.stableId,
      productKey: 'unique_other_key',
    };
    const rejected = validateProductRecords([base, dupKey, dupId]);
    expect(rejected.some((r) => r.code === 'SEED_PRODUCT_KEY_DUPLICATE')).toBe(true);
    expect(rejected.some((r) => r.code === 'SEED_STABLE_ID_DUPLICATE')).toBe(true);
  });

  it('rejects invalid category coverage and nutrition', () => {
    const bad: ProductSeedRecord = {
      ...PILOT_PRODUCTS[0]!,
      productKey: 'bad_key_only',
      stableId: 'c2010001-0000-4000-8000-eeeeeeeeeeee',
      categoryCode: 'meat_poultry',
      nutrition: {
        calories: -1,
        protein: 0,
        fat: 0,
        carbohydrate: 0,
        source: 'IMPORT',
        sourceRef: 'USDA_FDC',
        confidenceLabel: 'source-provided',
      },
    };
    const rejected = validateProductRecords([bad]);
    expect(rejected.some((r) => r.code === 'SEED_NUTRITION_INVALID')).toBe(true);
    expect(rejected.some((r) => r.code === 'SEED_CATEGORY_COVERAGE_MISSING')).toBe(true);
  });

  it('rejects vegan + milk allergen conflict', () => {
    const bad: ProductSeedRecord = {
      ...PILOT_PRODUCTS.find((p) => p.productKey === 'step092_milk')!,
      productKey: 'conflict_dairy_vegan',
      stableId: 'c2010001-0000-4000-8000-dddddddddddd',
      dietaryTags: [{ code: 'vegan', source: 'IMPORT', confidenceLabel: 'source-provided' }],
      allergens: [{ code: 'milk', presence: 'CONTAINS', source: 'IMPORT', confidenceLabel: 'source-provided' }],
    };
    // Pad with other categories minimally via full pilot minus one + bad is heavy; unit-check single helper:
    const conflicts = validateProductRecords(
      PILOT_PRODUCTS.map((p) => (p.productKey === 'step092_milk' ? bad : p)),
    );
    expect(conflicts.some((r) => r.code === 'SEED_DIETARY_CONFLICT')).toBe(true);
  });

  it('checksum changes when product payload changes', () => {
    const base = buildPilotManifest();
    const tweaked = withComputedChecksum({
      datasetVersion: base.datasetVersion,
      schemaVersion: SEED_SCHEMA_VERSION,
      sourcePolicyVersion: SEED_SOURCE_POLICY_VERSION,
      releaseDate: base.releaseDate,
      products: base.products.map((p, i) =>
        i === 0 ? { ...p, canonicalName: p.canonicalName + ' X' } : p,
      ),
    });
    expect(tweaked.checksum).not.toBe(base.checksum);
    expect(computeProductsChecksum(base.products)).toBe(base.checksum);
  });
});
