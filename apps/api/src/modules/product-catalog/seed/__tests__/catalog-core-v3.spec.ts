import { describe, expect, it } from 'vitest';
import { buildCatalogCoreV3Manifest } from '../catalog-core-v3.dataset';
import { validateManifest } from '../validate-manifest';

describe('catalog-core-v3 manifest', () => {
  const manifest = buildCatalogCoreV3Manifest();

  it('links previous version and size gate', () => {
    expect(manifest.datasetVersion).toBe('catalog-core-v3');
    expect(manifest.previousDatasetVersion).toBe('catalog-core-v2');
    expect(manifest.productCount).toBeGreaterThanOrEqual(250);
    expect(manifest.productCount).toBeLessThanOrEqual(350);
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('requires full source provenance', () => {
    expect(manifest.sourceCoverage?.withSourceRef).toBe(manifest.productCount);
    expect(manifest.sourceCoverage?.withSourceRecordId).toBe(manifest.productCount);
    expect(manifest.reviewSummary?.blocking).toBe(0);
    for (const p of manifest.products) {
      expect(p.nutrition?.sourceRef).toBeTruthy();
      expect(p.nutrition?.sourceRecordId).toBeTruthy();
      expect(p.nutrition?.basis).toBe('per_100g');
      expect(p.seedProvenance.datasetVersion).toBe('catalog-core-v3');
    }
  });

  it('meets category minimums', () => {
    const mins: Record<string, number> = {
      meat_poultry: 20,
      fish_seafood: 15,
      dairy: 20,
      eggs: 4,
      grains: 20,
      pasta: 8,
      vegetables: 45,
      fruits: 30,
      legumes: 12,
      oils_fats: 8,
      sauces: 12,
      spices: 20,
      technological_ingredients: 10,
    };
    for (const [code, min] of Object.entries(mins)) {
      expect(manifest.categoryCoverage?.[code] ?? 0).toBeGreaterThanOrEqual(min);
    }
  });
});
