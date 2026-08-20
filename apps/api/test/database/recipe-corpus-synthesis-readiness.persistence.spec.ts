import { describe, expect, it } from 'vitest';
import { runSynthesisReadiness } from '../../scripts/recipe-corpus-synthesis-readiness-01';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('RECIPE-CORPUS-SYNTHESIS-READINESS-01 real corpus persistence', () => {
  it('persists clusters/facts/briefs twice without duplicates and preserves provenance', async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString }) => {
      const first = await runSynthesisReadiness(connectionString);
      const firstCounts = await pool.query<{ clusters: string; facts: string; briefs: string }>('SELECT (SELECT count(*) FROM "DishConceptCluster") AS clusters, (SELECT count(*) FROM "RecipeResearchFact") AS facts, (SELECT count(*) FROM "RecipeSynthesisBrief") AS briefs');
      const second = await runSynthesisReadiness(connectionString);
      const secondCounts = await pool.query<{ clusters: string; facts: string; briefs: string }>('SELECT (SELECT count(*) FROM "DishConceptCluster") AS clusters, (SELECT count(*) FROM "RecipeResearchFact") AS facts, (SELECT count(*) FROM "RecipeSynthesisBrief") AS briefs');
      expect(first.candidates).toHaveLength(316);
      expect(first.clusters.length).toBeGreaterThan(0);
      expect(first.facts.length).toBeGreaterThan(0);
      expect(first.briefs.length).toBeGreaterThanOrEqual(10);
      expect(second.briefs.map((brief) => brief.briefId)).toEqual(first.briefs.map((brief) => brief.briefId));
      expect(secondCounts.rows[0]).toEqual(firstCounts.rows[0]);
      expect(Number(secondCounts.rows[0]!.clusters)).toBe(first.clusters.length);
      expect(Number(secondCounts.rows[0]!.facts)).toBe(first.facts.length);
      expect(Number(secondCounts.rows[0]!.briefs)).toBe(first.briefs.length);
      const provenance = await pool.query<{ sourceCodes: unknown; provenance: unknown }>('SELECT "sourceCodes", "provenance" FROM "DishConceptCluster" c JOIN "RecipeResearchFact" f ON f."clusterId" = c."id" LIMIT 1');
      expect(provenance.rows[0]?.sourceCodes).toBeTruthy();
      expect(provenance.rows[0]?.provenance).toBeTruthy();
      const recipeVersions = await pool.query<{ count: string }>('SELECT count(*) FROM "RecipeVersion"');
      expect(recipeVersions.rows[0]!.count).toBe('0');
    });
  }, 300000);
});
