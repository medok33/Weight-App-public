import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { RecipeKnowledgeSynthesisPersistence } from '../../src/modules/recipe-platform/application/recipe-knowledge-synthesis.persistence';
import type { DishConceptCluster, RecipeResearchFact, SynthesisBrief } from '../../src/modules/recipe-platform/domain/recipe-knowledge-synthesis.policy';
import type { PrismaService } from '../../src/infrastructure/database/prisma.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = { query: (text: string, values: unknown[] = []) => pool.query(text, values) } as PrismaService;
const persistence = new RecipeKnowledgeSynthesisPersistence(db);
const clusterId = 'dcluster_abcdef0123456789abcdef01';
const factId = 'fact_abcdef0123456789abcdef02';
const briefId = 'brief_abcdef0123456789abcdef03';

describe('STEP-322..328 knowledge synthesis persistence', () => {
  beforeAll(async () => {
    await pool.query(readFileSync(resolve(process.cwd(), 'prisma/migrations/225_recipe_knowledge_synthesis/migration.sql'), 'utf8'));
    await pool.query(`DELETE FROM "RecipeResearchFact" WHERE "clusterId" IN (SELECT "id" FROM "DishConceptCluster" WHERE "conceptKey" = 'persistence-fixture')`);
    await pool.query(`DELETE FROM "RecipeSynthesisBrief" WHERE "clusterId" IN (SELECT "id" FROM "DishConceptCluster" WHERE "conceptKey" = 'persistence-fixture')`);
    await pool.query(`DELETE FROM "DishConceptCluster" WHERE "conceptKey" = 'persistence-fixture'`);
  });

  afterAll(async () => { await pool.end(); });

  it('round-trips cluster, facts, conflict state, and synthesis brief without publication tables', async () => {
    const cluster: DishConceptCluster = {
      clusterId, clusterVersion: 'recipe-knowledge-synthesis/v1', conceptKey: 'persistence-fixture', displayLabel: 'Fixture',
      candidateIds: ['candidate-a', 'candidate-b'], sourceCount: 2, sourceCodes: ['IAMCOOK', 'RUSSIANFOOD'], representativeCandidateId: 'candidate-a',
      ingredientSignature: ['egg:binding'], techniqueSignature: ['bake'], slotHints: ['breakfast'], fingerprint: 'abcdef0123456789abcdef0123456789',
      sourceQualityScore: { score: 0.8, reasons: ['fixture'], evidence: {} }, weightAppFitScore: { score: 0.7, reasons: ['fixture'], evidence: {} },
      status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const fact: RecipeResearchFact = {
      factId, clusterId, factType: 'TEMPERATURE', normalizedValue: '180', unit: 'C', supportingCandidateIds: ['candidate-a'], supportingSourceCodes: ['IAMCOOK'], supportingCandidateCount: 1,
      confidence: 0.6, conflictLevel: 'HIGH', requiresReview: true, provenance: [{ candidateId: 'candidate-a', sourceCode: 'IAMCOOK', sourceUrl: 'https://example.invalid', rawSnapshotHash: 'hash' }], derivedAt: new Date().toISOString(),
    };
    const brief: SynthesisBrief = {
      briefId, briefVersion: 'recipe-knowledge-synthesis/v1', clusterId, coverageSlot: 'breakfast', objective: 'fixture', approvedProducts: ['egg'], forbiddenProducts: [], targetNutrition: null, targetCost: null, targetCookTime: 20,
      allowedEquipment: ['oven'], requiredTechniques: ['bake'], optionalTechniques: [], requiredFacts: [], conflictingFacts: [factId], unresolvedFacts: [], differentiationReason: 'fixture', evidenceSummary: { candidateIds: ['candidate-a', 'candidate-b'], sourceCodes: ['IAMCOOK', 'RUSSIANFOOD'], factIds: [factId], rejectedFactIds: [], conflictLevels: ['HIGH'], scores: { sourceQuality: 0.8, weightAppFit: 0.7 } }, status: 'BLOCKED_CONFLICT', approvalState: 'SYSTEM_BLOCKED',
    };
    await persistence.saveCluster(cluster);
    await persistence.saveFacts([fact]);
    await persistence.saveBrief(brief);
    const counts = await pool.query<{ clusters: number; facts: number; briefs: number }>(`SELECT (SELECT COUNT(*) FROM "DishConceptCluster" WHERE "conceptKey"='persistence-fixture')::int AS clusters, (SELECT COUNT(*) FROM "RecipeResearchFact" WHERE "clusterId"=(SELECT "id" FROM "DishConceptCluster" WHERE "conceptKey"='persistence-fixture'))::int AS facts, (SELECT COUNT(*) FROM "RecipeSynthesisBrief" WHERE "clusterId"=(SELECT "id" FROM "DishConceptCluster" WHERE "conceptKey"='persistence-fixture'))::int AS briefs`);
    expect(counts.rows[0]).toEqual({ clusters: 1, facts: 1, briefs: 1 });
    const stored = await pool.query<{ conflictLevel: string; approvalState: string }>(`SELECT f."conflictLevel", b."approvalState" FROM "RecipeResearchFact" f JOIN "RecipeSynthesisBrief" b ON b."clusterId"=f."clusterId" WHERE f."clusterId"=(SELECT "id" FROM "DishConceptCluster" WHERE "conceptKey"='persistence-fixture')`);
    expect(stored.rows[0]).toEqual({ conflictLevel: 'HIGH', approvalState: 'SYSTEM_BLOCKED' });
  });
});
