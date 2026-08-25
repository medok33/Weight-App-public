import { describe, expect, it } from 'vitest';
import { runDesignChoiceAudit } from '../../scripts/recipe-synthesis-design-choice-policy-01';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01 disposable acceptance', () => {
  it('replays the unchanged design-choice audit twice without design rows or source mutation', async () => {
    await withDisposableMigratedDb(async ({ pool }) => {
      const sourceFactsBefore = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "RecipeResearchFact"');
      const first = await runDesignChoiceAudit();
      const second = await runDesignChoiceAudit();
      expect(first.result.metrics).toEqual(second.result.metrics);
      expect(first.result.metrics.PRODUCT_SELECTION_PENDING).toBe(42);
      expect(first.result.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER).toBe(1);
      const metadata = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "RecipeSynthesisBrief" WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-synthesis-product-policy/v3'`);
      expect(metadata.rows[0]?.count).toBe('0');
      const sourceFacts = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "RecipeResearchFact"');
      expect(sourceFacts.rows[0]?.count).toBe(sourceFactsBefore.rows[0]?.count);
    }, 300000);
  }, 300000);
});
