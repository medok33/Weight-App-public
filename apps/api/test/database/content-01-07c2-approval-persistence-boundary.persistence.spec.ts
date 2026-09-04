import { describe, expect, it } from 'vitest';
import { RecipeKnowledgeSynthesisPersistence } from '../../src/modules/recipe-platform/application/recipe-knowledge-synthesis.persistence';
import { RecipeSynthesisBriefApprovalService } from '../../src/modules/recipe-platform/application/recipe-synthesis-brief-approval.service';
import { briefContentPayload, computeBriefContentHash } from '../../src/modules/recipe-platform/domain/recipe-synthesis-brief-approval.policy';
import { RICE_PUMPKIN_PORRIDGE_TARGET, TOMATO_OMELET_TARGET } from '../../src/modules/recipe-platform/domain/synthesis-target-contract';
import type { DishConceptCluster, SynthesisBrief } from '../../src/modules/recipe-platform/domain/recipe-knowledge-synthesis.policy';
import type { PrismaService, SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

const cluster: DishConceptCluster = {
  clusterId: 'dcluster_abcdef0123456789abcdef01', clusterVersion: 'test/v1', conceptKey: 'content-07c2-approval-boundary', displayLabel: 'Approval boundary',
  candidateIds: ['candidate-1'], sourceCount: 1, sourceCodes: ['TEST'], representativeCandidateId: 'candidate-1', ingredientSignature: ['egg'], techniqueSignature: ['bake'], slotHints: ['breakfast'], fingerprint: 'abcdef0123456789abcdef0123456789',
  sourceQualityScore: { score: 1, reasons: [], evidence: {} }, weightAppFitScore: { score: 1, reasons: [], evidence: {} }, status: 'ACTIVE', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
};

function brief(overrides: Partial<SynthesisBrief> = {}): SynthesisBrief {
  return {
    briefId: 'brief_abcdef0123456789abcdef02', briefVersion: 'content-07c2/v1', clusterId: cluster.clusterId, coverageSlot: 'breakfast', objective: 'content A', approvedProducts: ['egg', 'tomato'], forbiddenProducts: ['rice'], targetNutrition: { kcal: 200 }, targetCost: 100, targetCookTime: 20,
    allowedEquipment: ['pan'], requiredTechniques: ['bake'], optionalTechniques: ['mix'], requiredFacts: ['fact-1'], conflictingFacts: [], unresolvedFacts: [], differentiationReason: 'fixture',
    evidenceSummary: { candidateIds: ['candidate-1'], sourceCodes: ['TEST'], factIds: ['fact-1'], rejectedFactIds: [], conflictLevels: [], scores: { sourceQuality: 1, weightAppFit: 1 } },
    deterministicSelections: [{ sourceLabel: 'egg', productId: 'egg', quantity: 2, unit: 'piece', role: 'CORE', optional: false, authority: 'TEST' }], ownerDecisions: { sunflowerOil: 'sunflower_oil', butterRequired: 'NO' }, exclusions: ['butter'], servings: 2, totalTimeMinutes: 20,
    status: 'DRAFT', approvalState: 'PENDING', ...overrides,
  };
}

describe('CONTENT-01 07C2 approval/persistence boundary', () => {
  it('self-contained load preserves every hash-bound field on insert and conflict refresh', async () => {
    await withDisposableMigratedDb(async ({ createDb }) => {
      const persistence = new RecipeKnowledgeSynthesisPersistence(createDb());
      await persistence.saveCluster(cluster);
      const a = brief();
      await persistence.saveBrief(a);
      const loadedA = await persistence.loadBrief(a.briefId);
      expect(loadedA).toBeTruthy();
      expect(briefContentPayload(loadedA!)).toEqual(briefContentPayload(a));
      expect(computeBriefContentHash(loadedA!)).toBe(computeBriefContentHash(a));
      expect(loadedA!.clusterId).toBe(a.clusterId);
      const b = brief({ objective: 'content B', approvedProducts: ['egg', 'tomato', 'sunflower_oil'], deterministicSelections: [{ sourceLabel: 'oil', productId: 'sunflower_oil', quantity: 10, unit: 'g', role: 'CORE', optional: false, authority: 'OWNER' }], ownerDecisions: { sunflowerOil: 'sunflower_oil', butterRequired: 'NO', revision: 'B' }, exclusions: ['butter', 'mayo'], servings: 3, totalTimeMinutes: 25, requiredTechniques: ['bake', 'mix'], evidenceSummary: { ...a.evidenceSummary, candidateIds: ['candidate-b'] } });
      await persistence.saveBrief(b);
      const loadedB = await persistence.loadBrief(b.briefId);
      expect(computeBriefContentHash(loadedB!)).toBe(computeBriefContentHash(b));
      expect(loadedB).toMatchObject({ clusterId: b.clusterId, objective: 'content B', approvedProducts: b.approvedProducts, deterministicSelections: b.deterministicSelections, ownerDecisions: b.ownerDecisions, exclusions: b.exclusions, servings: 3, totalTimeMinutes: 25, requiredTechniques: b.requiredTechniques });
    });
  });

  it('fails closed without an exact persisted domainClusterId', async () => {
    await withDisposableMigratedDb(async ({ createDb, pool }) => {
      const persistence = new RecipeKnowledgeSynthesisPersistence(createDb());
      await persistence.saveCluster(cluster);
      const a = brief();
      await persistence.saveBrief(a);
      await pool.query(`UPDATE "RecipeSynthesisBrief" SET "domainClusterId"=NULL WHERE id=(SELECT id FROM "RecipeSynthesisBrief" LIMIT 1)`);
      await expect(persistence.loadBrief(a.briefId)).rejects.toThrow('BRIEF_DOMAIN_CLUSTER_ID_MISSING');
    });
  });

  it('prevents approval laundering, stale A approval, and stale caller approval after B refresh', async () => {
    await withDisposableMigratedDb(async ({ createDb }) => {
      const db = createDb(); const persistence = new RecipeKnowledgeSynthesisPersistence(db); const approvals = new RecipeSynthesisBriefApprovalService(db);
      await persistence.saveCluster(cluster);
      const a = brief(); const hashA = computeBriefContentHash(a);
      await persistence.saveBrief(a); const loadedA = (await persistence.loadBrief(a.briefId))!;
      await approvals.approveExact(loadedA, hashA, 'owner-a');
      expect(await approvals.hasCurrentApproval(loadedA)).toBe(true);
      const b = brief({ objective: 'content B', status: 'APPROVED_FOR_SYNTHESIS', approvalState: 'OWNER_APPROVED' });
      await persistence.saveBrief(b);
      const loadedB = (await persistence.loadBrief(b.briefId))!;
      expect(loadedB).toMatchObject({ status: 'READY_FOR_REVIEW', approvalState: 'PENDING' });
      await expect(approvals.approveExact(loadedA, hashA, 'owner-a-stale')).rejects.toThrow('BRIEF_PERSISTED_CONTENT_HASH_MISMATCH');
      expect(await approvals.hasCurrentApproval(loadedA)).toBe(false);
      expect(await approvals.hasCurrentApproval(loadedB)).toBe(false);
      expect((await persistence.loadBrief(b.briefId))!).toMatchObject({ status: 'READY_FOR_REVIEW', approvalState: 'PENDING', objective: 'content B' });
      const hashB = computeBriefContentHash(loadedB);
      await approvals.approveExact(loadedB, hashB, 'owner-b');
      const approvedB = (await persistence.loadBrief(b.briefId))!;
      expect(await approvals.hasCurrentApproval(approvedB)).toBe(true);
    });
  });

  it('serializes stale approval and same-id refresh so B never remains approved by A', async () => {
    await withDisposableMigratedDb(async ({ createDb }) => {
      const base = createDb(); let release!: () => void; let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
      const releaseLock = new Promise<void>((resolve) => { release = resolve; });
      const controlled = {
        ...base,
        withTransaction: async <T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> => base.withTransaction(async (query) => fn(async (text, values = []) => {
          const result = await query(text, values);
          if (/FROM\s+"RecipeSynthesisBrief"[\s\S]*FOR UPDATE/i.test(text)) { signalLocked(); await releaseLock; }
          return result;
        })),
      } as PrismaService;
      const persistence = new RecipeKnowledgeSynthesisPersistence(base); const approvals = new RecipeSynthesisBriefApprovalService(controlled);
      await persistence.saveCluster(cluster);
      const a = brief(); const hashA = computeBriefContentHash(a); await persistence.saveBrief(a);
      const loadedA = (await persistence.loadBrief(a.briefId))!;
      const approving = approvals.approveExact(loadedA, hashA, 'owner-a');
      await locked;
      const savingB = persistence.saveBrief(brief({ objective: 'content B concurrent' }));
      release();
      await Promise.all([approving, savingB]);
      const b = (await persistence.loadBrief(a.briefId))!;
      expect(b).toMatchObject({ objective: 'content B concurrent', status: 'DRAFT', approvalState: 'PENDING' });
      expect(await approvals.hasCurrentApproval(b)).toBe(false);
    });
  });

  it('validates actual reloaded Tomato and Rice target contracts', async () => {
    await withDisposableMigratedDb(async ({ createDb }) => {
      const persistence = new RecipeKnowledgeSynthesisPersistence(createDb());
      await persistence.saveCluster({ ...cluster, clusterId: TOMATO_OMELET_TARGET.clusterId, fingerprint: '11111111111111111111111111111111', conceptKey: 'tomato-target' });
      await persistence.saveCluster({ ...cluster, clusterId: RICE_PUMPKIN_PORRIDGE_TARGET.clusterId, fingerprint: '22222222222222222222222222222222', conceptKey: 'rice-target' });
      const tomato = brief({ briefId: 'brief_111111111111111111111111', clusterId: TOMATO_OMELET_TARGET.clusterId });
      const rice = brief({ briefId: 'brief_222222222222222222222222', clusterId: RICE_PUMPKIN_PORRIDGE_TARGET.clusterId, approvedProducts: ['rice', 'pumpkin'], ownerDecisions: { orangeZestRequired: 'NO', orangeZestIncluded: 'NO' }, exclusions: ['orange_zest'] });
      for (const item of [tomato, rice]) { await persistence.saveBrief(item); await createDb().withTransaction(async () => undefined); }
      const db = createDb(); const approvals = new RecipeSynthesisBriefApprovalService(db);
      for (const item of [tomato, rice]) { const loaded = (await persistence.loadBrief(item.briefId))!; await approvals.approveExact(loaded, computeBriefContentHash(item), 'owner'); }
      TOMATO_OMELET_TARGET.validateBrief((await persistence.loadBrief(tomato.briefId))!);
      RICE_PUMPKIN_PORRIDGE_TARGET.validateBrief((await persistence.loadBrief(rice.briefId))!);
    });
  });
});
