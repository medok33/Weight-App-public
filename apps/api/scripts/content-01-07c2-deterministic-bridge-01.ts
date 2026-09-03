/* eslint-disable no-console */
import { Pool } from 'pg';
import { runPipeline } from './recipe-corpus-synthesis-readiness-01';
import { computeBriefContentHash, briefContentPayload } from '../src/modules/recipe-platform/domain/recipe-synthesis-brief-approval.policy';
import { RecipeKnowledgeSynthesisPersistence } from '../src/modules/recipe-platform/application/recipe-knowledge-synthesis.persistence';
import { RecipeSynthesisBriefApprovalService } from '../src/modules/recipe-platform/application/recipe-synthesis-brief-approval.service';

const TARGETS = ['dcluster_87b96a2fc22b24da2b6baa44', 'dcluster_06210e70a9392b5421aa0155'];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('UNSAFE_DATABASE_TARGET:DATABASE_URL_MISSING');
  const result = runPipeline();
  const briefs = result.briefs.filter((b) => TARGETS.includes(b.clusterId));
  if (briefs.length !== 2) throw new Error(`TARGET_BRIEFS_MISSING:${briefs.length}`);
  for (const brief of briefs) {
    if (!brief.deterministicSelections?.length || brief.unresolvedFacts.length || brief.conflictingFacts.length) throw new Error(`DETERMINISTIC_PREFLIGHT_FAILED:${brief.clusterId}`);
    brief.evidenceSummary = { ...brief.evidenceSummary, deterministicSelections: brief.deterministicSelections, ownerDecisions: brief.ownerDecisions ?? {}, exclusions: brief.exclusions ?? [], servings: brief.servings ?? null, totalTimeMinutes: brief.totalTimeMinutes ?? null };
    brief.status = 'DRAFT'; brief.approvalState = 'PENDING';
    brief.contentHash = computeBriefContentHash(brief);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const persistence = new RecipeKnowledgeSynthesisPersistence(pool as unknown as import('../src/infrastructure/database/prisma.service').PrismaService);
  const approvals = new RecipeSynthesisBriefApprovalService(pool as unknown as import('../src/infrastructure/database/prisma.service').PrismaService);
  try {
    for (const cluster of result.clusters) await persistence.saveCluster(cluster);
    await persistence.saveFacts(result.facts);
    for (const brief of briefs) {
      await persistence.saveBrief(brief);
      const reloaded = await persistence.loadBrief(brief.briefId, brief.clusterId);
      if (!reloaded || computeBriefContentHash(reloaded) !== brief.contentHash) {
        const differingFields = reloaded ? Object.keys(briefContentPayload(brief)).filter((key) => JSON.stringify((briefContentPayload(brief) as Record<string, unknown>)[key]) !== JSON.stringify((briefContentPayload(reloaded) as Record<string, unknown>)[key])) : ['brief_missing'];
        throw new Error(`HASH_ROUNDTRIP_FAILED:${brief.clusterId}:${differingFields.join(',')}:expected=${JSON.stringify({ selections: brief.deterministicSelections, ownerDecisions: brief.ownerDecisions, evidence: brief.evidenceSummary })}:actual=${JSON.stringify(reloaded ? { selections: reloaded.deterministicSelections, ownerDecisions: reloaded.ownerDecisions, evidence: reloaded.evidenceSummary } : null)}`);
      }
      await approvals.approveExact(reloaded, brief.contentHash!, 'owner-07c2');
      const approved = await persistence.loadBrief(brief.briefId, brief.clusterId);
      if (!approved || !(await approvals.hasCurrentApproval(approved))) throw new Error(`APPROVAL_ROUNDTRIP_FAILED:${brief.clusterId}`);
    }
    console.log(JSON.stringify({ targets: briefs.map((b) => ({ clusterId: b.clusterId, briefId: b.briefId, contentHash: b.contentHash, status: 'APPROVED_FOR_SYNTHESIS', approvalState: 'OWNER_APPROVED', hasCurrentApproval: true })), aiCalls: 0, recipeVersions: 0 }, null, 2));
  } finally { await pool.end(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
