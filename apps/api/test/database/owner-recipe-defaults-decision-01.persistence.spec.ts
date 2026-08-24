import { describe, expect, it } from 'vitest';
import { persistProductSelectionResult, runProductSelectionWithPersistence } from '../../scripts/recipe-product-selection-01';
import { runSynthesisReadiness } from '../../scripts/recipe-corpus-synthesis-readiness-01';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('OWNER-RECIPE-DEFAULTS-DECISION-01 disposable acceptance', () => {
  it('persists v2 owner defaults twice without new rows or changed selections', async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      await runSynthesisReadiness(connectionString);
      const first = await runProductSelectionWithPersistence(connectionString, { applySynthesisDefaults: true });
      const firstRows = await pool.query(`SELECT "id","evidenceSummary"->'productSelectionDecisions' AS decisions FROM "RecipeSynthesisBrief" WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-synthesis-product-policy/v2' ORDER BY "id"`);
      const second = await persistProductSelectionResult(first, connectionString, { applySynthesisDefaults: true });
      const secondRows = await pool.query(`SELECT "id","evidenceSummary"->'productSelectionDecisions' AS decisions FROM "RecipeSynthesisBrief" WHERE "evidenceSummary"->>'productSelectionPolicyVersion'='recipe-synthesis-product-policy/v2' ORDER BY "id"`);
      expect(firstRows.rows).toEqual(secondRows.rows);
      expect(first.metrics).toEqual(second.metrics);
      expect(firstRows.rowCount).toBe(11);
      expect(first.briefsUpdated).toBe(second.briefsUpdated);
      expect(first.metrics.FAMILY_DEFAULT_PRODUCT_SELECTED).toBeGreaterThanOrEqual(1);
    }, 300000);
  }, 600000);
});
