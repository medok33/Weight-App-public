import { describe, expect, it } from 'vitest';
import { buildCatalogCoreV2Manifest } from '../catalog-core-v2.dataset';
import { validateManifest } from '../validate-manifest';

describe('catalog-core-v2 manifest', () => {
  it('links previous pilot and stays in 150–180', () => {
    const m = buildCatalogCoreV2Manifest();
    expect(m.previousDatasetVersion).toBe('pilot-v1');
    expect(m.productCount).toBeGreaterThanOrEqual(150);
    expect(m.productCount).toBeLessThanOrEqual(180);
    expect(validateManifest(m)).toEqual([]);
    expect(m.reviewSummary?.blocking).toBe(0);
  });

  it('keeps distinct dry/boiled pairs', () => {
    const m = buildCatalogCoreV2Manifest();
    const keys = new Set(m.products.map((p) => p.productKey));
    expect(keys.has('buckwheat_boiled')).toBe(true);
    expect(keys.has('step093_buckwheat')).toBe(true);
    expect(keys.has('rice_boiled')).toBe(true);
    expect(keys.has('pasta_boiled')).toBe(true);
    const dryBoiled = m.products.filter((p) => p.productKey.includes('buckwheat'));
    expect(new Set(dryBoiled.map((p) => p.form)).size).toBeGreaterThanOrEqual(2);
  });
});
