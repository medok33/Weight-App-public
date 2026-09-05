/* eslint-disable no-console */
import { Pool } from 'pg';
import { runPipeline } from './recipe-corpus-synthesis-readiness-01';
import { computeBriefContentHash, briefContentPayload } from '../src/modules/recipe-platform/domain/recipe-synthesis-brief-approval.policy';
import { RecipeKnowledgeSynthesisPersistence } from '../src/modules/recipe-platform/application/recipe-knowledge-synthesis.persistence';
import { RecipeSynthesisBriefApprovalService } from '../src/modules/recipe-platform/application/recipe-synthesis-brief-approval.service';
import { RICE_PUMPKIN_PORRIDGE_TARGET, TOMATO_OMELET_TARGET } from '../src/modules/recipe-platform/domain/synthesis-target-contract';
import type { PrismaService, SqlQuery } from '../src/infrastructure/database/prisma.service';
import type { SynthesisBrief } from '../src/modules/recipe-platform/domain/recipe-knowledge-synthesis.policy';

const TARGETS = ['dcluster_87b96a2fc22b24da2b6baa44', 'dcluster_06210e70a9392b5421aa0155'];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('UNSAFE_DATABASE_TARGET:DATABASE_URL_MISSING');
  const result = runPipeline();
  const briefs = result.briefs.filter((b) => TARGETS.includes(b.clusterId));
  const targetClusters = result.clusters.filter((cluster) => TARGETS.includes(cluster.clusterId));
  const targetFacts = result.facts.filter((fact) => TARGETS.includes(fact.clusterId));
  if (briefs.length !== 2 || targetClusters.length !== 2) throw new Error(`TARGET_BRIEFS_MISSING:${briefs.length}:${targetClusters.length}`);
  for (const brief of briefs) {
    if (!brief.deterministicSelections?.length || brief.unresolvedFacts.length || brief.conflictingFacts.length) throw new Error(`DETERMINISTIC_PREFLIGHT_FAILED:${brief.clusterId}`);
    brief.evidenceSummary = { ...brief.evidenceSummary, deterministicSelections: brief.deterministicSelections, ownerDecisions: brief.ownerDecisions ?? {}, exclusions: brief.exclusions ?? [], servings: brief.servings ?? null, totalTimeMinutes: brief.totalTimeMinutes ?? null };
    brief.status = 'DRAFT'; brief.approvalState = 'PENDING';
    brief.contentHash = computeBriefContentHash(brief);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = transactionDb(pool);
  const persistence = new RecipeKnowledgeSynthesisPersistence(db);
  const approvals = new RecipeSynthesisBriefApprovalService(db);
  try {
    for (const cluster of targetClusters) await persistence.saveCluster(cluster);
    await persistence.saveFacts(targetFacts);
    for (const brief of briefs) {
      await persistence.saveBrief(brief);
      const reloaded = await persistence.loadBrief(brief.briefId);
      if (!reloaded || computeBriefContentHash(reloaded) !== brief.contentHash) {
        const differingFields = reloaded ? Object.keys(briefContentPayload(brief)).filter((key) => JSON.stringify((briefContentPayload(brief) as Record<string, unknown>)[key]) !== JSON.stringify((briefContentPayload(reloaded) as Record<string, unknown>)[key])) : ['brief_missing'];
        throw new Error(`HASH_ROUNDTRIP_FAILED:${brief.clusterId}:${differingFields.join(',')}:expected=${JSON.stringify({ selections: brief.deterministicSelections, ownerDecisions: brief.ownerDecisions, evidence: brief.evidenceSummary })}:actual=${JSON.stringify(reloaded ? { selections: reloaded.deterministicSelections, ownerDecisions: reloaded.ownerDecisions, evidence: reloaded.evidenceSummary } : null)}`);
      }
      await approvals.approveExact(reloaded, brief.contentHash!, 'owner-07c2');
      const approved = await persistence.loadBrief(brief.briefId);
      if (!approved || !(await approvals.hasCurrentApproval(approved))) throw new Error(`APPROVAL_ROUNDTRIP_FAILED:${brief.clusterId}`);
      (brief.clusterId === TOMATO_OMELET_TARGET.clusterId ? TOMATO_OMELET_TARGET : RICE_PUMPKIN_PORRIDGE_TARGET).validateBrief(approved);
    }
    await verifySameIdAndStaleApproval(briefs[0]!, persistence, approvals);
    console.log(JSON.stringify({ targets: briefs.map((b) => ({ clusterId: b.clusterId, briefId: b.briefId, contentHash: b.contentHash, status: 'APPROVED_FOR_SYNTHESIS', approvalState: 'OWNER_APPROVED', hasCurrentApproval: true })), aiCalls: 0, recipeVersions: 0 }, null, 2));
  } finally { await pool.end(); }
}

async function verifySameIdAndStaleApproval(brief: SynthesisBrief, persistence: RecipeKnowledgeSynthesisPersistence, approvals: RecipeSynthesisBriefApprovalService): Promise<void> {
  const approvedA = await persistence.loadBrief(brief.briefId);
  if (!approvedA || !brief.contentHash) throw new Error('STALE_APPROVAL_SETUP_FAILED');
  const changedB = { ...approvedA, objective: `${approvedA.objective} (revised)`, status: 'DRAFT' as const, approvalState: 'PENDING' as const };
  const hashB = computeBriefContentHash(changedB);
  await persistence.saveBrief(changedB);
  const reloadedB = await persistence.loadBrief(brief.briefId);
  if (!reloadedB || computeBriefContentHash(reloadedB) !== hashB || reloadedB.clusterId !== changedB.clusterId || reloadedB.approvalState !== 'PENDING' || reloadedB.status === 'APPROVED_FOR_SYNTHESIS') throw new Error('SAME_BRIEF_ID_REFRESH_FAILED');
  try {
    await approvals.approveExact(approvedA, brief.contentHash, 'owner-07c2-stale');
    throw new Error('STALE_APPROVAL_ACCEPTED');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'BRIEF_PERSISTED_CONTENT_HASH_MISMATCH') throw error;
  }
  if (await approvals.hasCurrentApproval(approvedA)) throw new Error('STALE_CALLER_APPROVAL_ACCEPTED');
  const laundering = { ...reloadedB, status: 'APPROVED_FOR_SYNTHESIS' as const, approvalState: 'OWNER_APPROVED' as const };
  await persistence.saveBrief(laundering);
  const preApproved = await persistence.loadBrief(brief.briefId);
  if (!preApproved || preApproved.approvalState === 'OWNER_APPROVED' || preApproved.status === 'APPROVED_FOR_SYNTHESIS') throw new Error('APPROVAL_LAUNDERING_FAILED');
  await persistence.saveBrief(brief);
  const restored = await persistence.loadBrief(brief.briefId);
  if (!restored || computeBriefContentHash(restored) !== brief.contentHash) throw new Error('STALE_APPROVAL_RESTORE_FAILED');
  await approvals.approveExact(restored, brief.contentHash, 'owner-07c2-restore');
}

function transactionDb(pool: Pool): PrismaService {
  return {
    query: (text: string, values: unknown[] = []) => pool.query(text, values),
    withTransaction: async <T>(fn: (query: SqlQuery) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      const query: SqlQuery = (text, values = []) => client.query(text, values);
      try { await client.query('BEGIN'); const result = await fn(query); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  } as PrismaService;
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
