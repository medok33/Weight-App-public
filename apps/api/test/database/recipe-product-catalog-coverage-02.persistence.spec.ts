import { describe, expect, it } from 'vitest';
import { runCatalogSeed } from '../../src/modules/product-catalog/seed/apply-engine';
import { buildCatalogCoreV3Manifest } from '../../src/modules/product-catalog/seed/catalog-core-v3.dataset';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('RECIPE-PRODUCT-CATALOG-COVERAGE-02 catalog idempotency', () => {
  it('applies the authoritative catalog aliases twice without new products or nutrition versions', async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const manifest = buildCatalogCoreV3Manifest();
      const first = await runCatalogSeed({ client: pool, manifest, mode: 'apply' });
      const second = await runCatalogSeed({ client: pool, manifest, mode: 'apply' });
      expect(first.status).toBe('OK');
      expect(['OK', 'NO_OP']).toContain(second.status);
      expect(second.created).toHaveLength(0);
      expect(second.nutritionVersionsCreated).toHaveLength(0);
      expect(second.aliasesCreated).toBe(0);
    }, undefined);
  }, 300_000);
});
