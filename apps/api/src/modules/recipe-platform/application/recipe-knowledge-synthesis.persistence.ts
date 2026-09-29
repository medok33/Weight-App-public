import { Inject, Injectable } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type { DishConceptCluster, RecipeResearchFact, SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';
import { briefIdToStorageUuid } from '../domain/brief-identity';
import { mapRecipeSynthesisBriefRow } from './recipe-synthesis-brief.mapper';
import { recomputeBriefGrammageReadiness } from '../domain/recipe-grammage-readiness.policy';

/** Persistence boundary for the research layer only. It cannot publish recipe content. */
@Injectable()
export class RecipeKnowledgeSynthesisPersistence {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async saveCluster(cluster: DishConceptCluster): Promise<void> {
    await this.db.query(
      `INSERT INTO "DishConceptCluster" ("id", "clusterVersion", "conceptKey", "displayLabel", "candidateIds", "sourceCount", "sourceCodes", "representativeCandidateId", "ingredientSignature", "techniqueSignature", "slotHints", "fingerprint", "status", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::timestamptz, $14::timestamptz)
       ON CONFLICT ("fingerprint") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt", "status" = EXCLUDED."status"`,
      [toUuid(cluster.clusterId), cluster.clusterVersion, cluster.conceptKey, cluster.displayLabel, json(cluster.candidateIds), cluster.sourceCount, json(cluster.sourceCodes), cluster.representativeCandidateId, json(cluster.ingredientSignature), json(cluster.techniqueSignature), json(cluster.slotHints), cluster.fingerprint, cluster.status, cluster.createdAt],
    );
  }

  async saveFacts(facts: RecipeResearchFact[]): Promise<void> {
    for (const fact of facts) {
      await this.db.query(
        `INSERT INTO "RecipeResearchFact" ("id", "clusterId", "factType", "normalizedValue", "unit", "supportingCandidateIds", "supportingSourceCodes", "supportingCandidateCount", "confidence", "conflictLevel", "requiresReview", "provenance", "derivedAt")
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13::timestamptz)
         ON CONFLICT ("clusterId", "factType", "normalizedValue", "unit") DO UPDATE SET "supportingCandidateIds" = EXCLUDED."supportingCandidateIds", "supportingSourceCodes" = EXCLUDED."supportingSourceCodes", "supportingCandidateCount" = EXCLUDED."supportingCandidateCount", "confidence" = EXCLUDED."confidence", "conflictLevel" = EXCLUDED."conflictLevel", "requiresReview" = EXCLUDED."requiresReview", "provenance" = EXCLUDED."provenance", "derivedAt" = EXCLUDED."derivedAt"`,
        [toUuid(fact.factId), toUuid(fact.clusterId), fact.factType, fact.normalizedValue, fact.unit, json(fact.supportingCandidateIds), json(fact.supportingSourceCodes), fact.supportingCandidateCount, fact.confidence, fact.conflictLevel, fact.requiresReview, json(fact.provenance), fact.derivedAt],
      );
    }
  }

  async saveBrief(brief: SynthesisBrief): Promise<void> {
    // Readiness is recomputed from the persisted brief scope at this boundary.
    // A caller-provided receipt (including a fabricated READY marker) is never authority.
    let serverReadiness = brief.grammageReadiness;
    if (brief.status === 'APPROVED_FOR_SYNTHESIS') {
      const prior = await this.db.query<{ deterministicSelections: unknown; clusterId: string }>(`SELECT "deterministicSelections", "clusterId"::text AS "clusterId" FROM "RecipeSynthesisBrief" WHERE "id"=$1::uuid`, [briefIdToStorageUuid(brief.briefId)]);
      if (prior.rows[0] && prior.rows[0].clusterId !== toUuid(brief.clusterId)) throw new Error('GRAMMAGE_BRIEF_CLUSTER_MISMATCH');
      if (prior.rows[0] && canonicalJson(prior.rows[0].deterministicSelections) !== canonicalJson(brief.deterministicSelections ?? [])) throw new Error('GRAMMAGE_SCOPE_CHANGED');
      const clusterResult = await this.db.query<{ representativeCandidateId: string; domainClusterId: string | null }>(
        `SELECT "representativeCandidateId", "id"::text AS "domainClusterId" FROM "DishConceptCluster" WHERE "id"=$1::uuid`, [toUuid(brief.clusterId)],
      );
      const clusterRow = clusterResult.rows[0];
      if (!clusterRow || clusterRow.domainClusterId !== toUuid(brief.clusterId)) throw new Error('GRAMMAGE_CANONICAL_SCOPE_MISSING');
      let sourceScope: NonNullable<SynthesisBrief['deterministicSelections']>;
      try {
      sourceScope = await loadCanonicalDonorSourceScope((text, values) => this.db.query(text, values), brief.clusterId, clusterRow.representativeCandidateId);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('GRAMMAGE_CANONICAL_SCOPE_')) throw new Error('GRAMMAGE_READINESS_REQUIRED');
        throw error;
      }
      const selections = Array.isArray(brief.deterministicSelections) ? brief.deterministicSelections : [];
      const scopeKey = (line: any) => ({ sourceLabel: line.sourceLabel, productId: line.productId, quantity: line.quantity, unit: line.unit, sourceCandidateId: line.sourceCandidateId, sourceIngredientOrdinal: line.sourceIngredientOrdinal });
      if (canonicalJson(sourceScope.map(scopeKey)) !== canonicalJson(selections.map(scopeKey))) throw new Error('GRAMMAGE_CANONICAL_SCOPE_MISMATCH');
      serverReadiness = recomputeBriefGrammageReadiness({ ...brief, deterministicSelections: sourceScope });
      if (serverReadiness.readiness !== 'READY_FOR_SYNTHESIS' || serverReadiness.unresolvedRequiredLines !== 0 || serverReadiness.lines.length === 0) throw new Error('GRAMMAGE_READINESS_REQUIRED');
    } else if (brief.grammageReadiness) {
      // Non-approved rows may carry diagnostics, but never caller-owned readiness.
      serverReadiness = undefined;
    }
    const preApprovalStatus = brief.status === 'APPROVED_FOR_SYNTHESIS' ? 'READY_FOR_REVIEW' : brief.status;
    const preApprovalState = brief.approvalState === 'OWNER_APPROVED' ? 'PENDING' : brief.approvalState;
    await this.db.query(
      `INSERT INTO "RecipeSynthesisBrief" ("id", "briefVersion", "clusterId", "domainClusterId", "coverageSlot", "objective", "approvedProducts", "forbiddenProducts", "targetNutrition", "targetCost", "targetCookTime", "allowedEquipment", "requiredTechniques", "optionalTechniques", "requiredFacts", "conflictingFacts", "unresolvedFacts", "differentiationReason", "evidenceSummary", "deterministicSelections", "ownerDecisions", "exclusions", "servings", "totalTimeMinutes", "status", "approvalState")
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb, $23, $24, $25, $26)
       ON CONFLICT ("id") DO UPDATE SET "briefVersion"=EXCLUDED."briefVersion", "clusterId"=EXCLUDED."clusterId", "domainClusterId"=EXCLUDED."domainClusterId", "coverageSlot"=EXCLUDED."coverageSlot", "objective"=EXCLUDED."objective", "approvedProducts"=EXCLUDED."approvedProducts", "forbiddenProducts"=EXCLUDED."forbiddenProducts", "targetNutrition"=EXCLUDED."targetNutrition", "targetCost"=EXCLUDED."targetCost", "targetCookTime"=EXCLUDED."targetCookTime", "allowedEquipment"=EXCLUDED."allowedEquipment", "requiredTechniques"=EXCLUDED."requiredTechniques", "optionalTechniques"=EXCLUDED."optionalTechniques", "requiredFacts"=EXCLUDED."requiredFacts", "conflictingFacts"=EXCLUDED."conflictingFacts", "unresolvedFacts"=EXCLUDED."unresolvedFacts", "differentiationReason"=EXCLUDED."differentiationReason", "evidenceSummary"=EXCLUDED."evidenceSummary", "deterministicSelections"=EXCLUDED."deterministicSelections", "ownerDecisions"=EXCLUDED."ownerDecisions", "exclusions"=EXCLUDED."exclusions", "servings"=EXCLUDED."servings", "totalTimeMinutes"=EXCLUDED."totalTimeMinutes", "status"=EXCLUDED."status", "approvalState"=EXCLUDED."approvalState", "updatedAt"=now()`,
      [briefIdToStorageUuid(brief.briefId), brief.briefVersion, toUuid(brief.clusterId), brief.clusterId, brief.coverageSlot, brief.objective, json(brief.approvedProducts), json(brief.forbiddenProducts), brief.targetNutrition == null ? null : json(brief.targetNutrition), brief.targetCost ?? null, brief.targetCookTime ?? null, json(brief.allowedEquipment), json(brief.requiredTechniques), json(brief.optionalTechniques), json(brief.requiredFacts), json(brief.conflictingFacts), json(brief.unresolvedFacts), brief.differentiationReason, json({ ...brief.evidenceSummary, ...(serverReadiness ? { grammageReadiness: serverReadiness } : {}) }), json(brief.deterministicSelections ?? []), json(brief.ownerDecisions ?? {}), json(brief.exclusions ?? []), brief.servings ?? null, brief.totalTimeMinutes ?? null, preApprovalStatus, preApprovalState],
    );
  }

  async loadBrief(briefId: string): Promise<SynthesisBrief | null> {
    const result = await this.db.query<Record<string, unknown>>(`SELECT * FROM "RecipeSynthesisBrief" WHERE "id"=$1::uuid`, [briefIdToStorageUuid(briefId)]);
    const row = result.rows[0] as any;
    if (!row) return null;
    return mapRecipeSynthesisBriefRow(briefId, row);
  }

}

export async function loadCanonicalDonorSourceScope(query: SqlQuery, clusterId: string, representativeCandidateId: string): Promise<NonNullable<SynthesisBrief['deterministicSelections']>> {
    const cluster = await query<{ candidateIds: unknown }>(`SELECT "candidateIds" FROM "DishConceptCluster" WHERE "id"=$1::uuid`, [toUuid(clusterId)]);
    const ids = Array.isArray(cluster.rows[0]?.candidateIds) ? cluster.rows[0]!.candidateIds as string[] : [];
    const [sourceCode, externalId] = representativeCandidateId.split(':', 2);
    if (!sourceCode || !externalId || !ids.includes(representativeCandidateId)) throw new Error('GRAMMAGE_CANONICAL_SCOPE_MISSING');
    const rows = await query<{ externalId: string; sourceCode: string | null; inlinePayloadJson: any; normalizedJson: any }>(
      `SELECT c."externalId", s.code AS "sourceCode", snap."inlinePayloadJson", norm."normalizedJson"
       FROM "RecipeSourceCandidate" c
       LEFT JOIN "RecipeExternalSource" s ON s.id=c."sourceId"
       JOIN "RecipeSourceRawSnapshot" snap ON snap.id=c."rawSnapshotId"
       LEFT JOIN LATERAL (SELECT "normalizedJson" FROM "RecipeNormalizedCandidate" n WHERE n."candidateId"=c.id ORDER BY version DESC LIMIT 1) norm ON TRUE
       WHERE c."externalId"=$1 AND s.code=$2 AND snap."deletionStatus"='ACTIVE'`, [externalId, sourceCode],
    );
    const row = rows.rows[0];
    if (!row || !row.inlinePayloadJson) throw new Error('GRAMMAGE_CANONICAL_SCOPE_MISSING');
    const payload = row.inlinePayloadJson as Record<string, unknown>;
    const rawIngredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];
    const normalized = row.normalizedJson as Record<string, unknown> | null;
    const mapped = Array.isArray(normalized?.ingredients) ? normalized.ingredients : [];
    if (rawIngredients.length === 0 || mapped.length !== rawIngredients.length) throw new Error('GRAMMAGE_CANONICAL_SCOPE_INCOMPLETE');
    return mapped.map((item: any, index) => ({
      sourceLabel: typeof (rawIngredients[index] as any)?.name === 'string' ? (rawIngredients[index] as any).name : '',
      productId: typeof item?.productId === 'string' ? item.productId : null,
      quantity: typeof item?.quantity === 'number' ? item.quantity : null,
      unit: typeof item?.unit === 'string' ? item.unit : null,
      role: typeof (rawIngredients[index] as any)?.role === 'string' ? (rawIngredients[index] as any).role : 'REQUIRED',
      optional: false,
      authority: 'CANONICAL_DONOR_SOURCE',
      sourceCandidateId: representativeCandidateId,
      sourceIngredientOrdinal: index + 1,
    }));
}

function json(value: unknown): string { return JSON.stringify(value); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Domain ids are deterministic labels; persistence keeps UUID columns isolated from that public identity. */
function toUuid(value: string): string {
  const hex = value.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
