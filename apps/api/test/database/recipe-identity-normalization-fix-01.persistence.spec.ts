import { describe, expect, it } from 'vitest';
import { runProductSelection } from '../../scripts/recipe-product-selection-01';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('RECIPE-IDENTITY-NORMALIZATION-FIX-01 disposable acceptance', () => {
  it('replays normalization/readiness without changing source facts or selections', async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const sourceFactsBefore = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "RecipeResearchFact"');
      const first = await runProductSelection({ applySynthesisDefaults: true });
      const second = await runProductSelection({ applySynthesisDefaults: true });
      expect(second.metrics).toEqual(first.metrics);
      expect(first.metrics.COHORT_CLUSTERS_ANALYZED).toBe(11);
      expect(first.metrics.TOTAL_REQUIRED_INGREDIENTS).toBe(263);
      expect(first.metrics.PRODUCT_CATALOG_GAP).toBe(17);
      expect(first.metrics.PRODUCT_SELECTION_PENDING).toBe(41);
      expect(first.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER).toBe(3);
      const julien = first.clusters.find((cluster) => cluster.conceptName === 'Жульен с курицей и грибами в духовке');
      expect(julien).toMatchObject({ catalogGap: 0, selectionPending: 0, conflicts: 0, classification: 'READY_FOR_DETERMINISTIC_GRAMS' });
      const sourceFactsAfter = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "RecipeResearchFact"');
      expect(sourceFactsAfter.rows[0]?.count).toBe(sourceFactsBefore.rows[0]?.count);
    }, 300000);
  }, 300000);
});
