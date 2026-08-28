import { describe, expect, it } from 'vitest';
import { runProductSelectionWithPersistence } from '../../scripts/recipe-product-selection-01';
import { runSynthesisReadiness } from '../../scripts/recipe-corpus-synthesis-readiness-01';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('RECIPE-PRODUCT-SELECTION-POLICY-01 disposable acceptance', () => {
  it('persists deterministic decisions twice without new rows or changed selections', async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      await runSynthesisReadiness(connectionString);
      const first = await runProductSelectionWithPersistence(connectionString);
      const firstRows = await pool.query<{ briefs: string; metadata: string }>(`SELECT count(*)::text AS briefs, count(*) FILTER (WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-product-selection/v1')::text AS metadata FROM "RecipeSynthesisBrief"`);
      const firstDecisions = await pool.query(`SELECT "id","evidenceSummary"->'productSelectionDecisions' AS decisions FROM "RecipeSynthesisBrief" WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-product-selection/v1' ORDER BY "id"`);
      const second = await runProductSelectionWithPersistence(connectionString);
      const secondRows = await pool.query<{ briefs: string; metadata: string }>(`SELECT count(*)::text AS briefs, count(*) FILTER (WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-product-selection/v1')::text AS metadata FROM "RecipeSynthesisBrief"`);
      const secondDecisions = await pool.query(`SELECT "id","evidenceSummary"->'productSelectionDecisions' AS decisions FROM "RecipeSynthesisBrief" WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-product-selection/v1' ORDER BY "id"`);
      expect(first.metrics.COHORT_CLUSTERS_ANALYZED).toBe(11); expect(second.metrics).toEqual(first.metrics); expect(firstRows.rows[0]).toEqual(secondRows.rows[0]); expect(firstDecisions.rows).toEqual(secondDecisions.rows); expect(first.briefsUpdated).toBe(second.briefsUpdated); expect(firstRows.rows[0]!.metadata).toBe('11');
    }, 300000);
  }, 300000);
});
