import { Inject, Injectable } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { DishConceptCluster, RecipeResearchFact, SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';
import { briefIdToStorageUuid } from '../domain/brief-identity';
import { mapRecipeSynthesisBriefRow } from './recipe-synthesis-brief.mapper';

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
    const preApprovalStatus = brief.status === 'APPROVED_FOR_SYNTHESIS' ? 'READY_FOR_REVIEW' : brief.status;
    const preApprovalState = brief.approvalState === 'OWNER_APPROVED' ? 'PENDING' : brief.approvalState;
    await this.db.query(
      `INSERT INTO "RecipeSynthesisBrief" ("id", "briefVersion", "clusterId", "domainClusterId", "coverageSlot", "objective", "approvedProducts", "forbiddenProducts", "targetNutrition", "targetCost", "targetCookTime", "allowedEquipment", "requiredTechniques", "optionalTechniques", "requiredFacts", "conflictingFacts", "unresolvedFacts", "differentiationReason", "evidenceSummary", "status", "approvalState")
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19::jsonb, $20, $21)
       ON CONFLICT ("id") DO UPDATE SET "briefVersion"=EXCLUDED."briefVersion", "clusterId"=EXCLUDED."clusterId", "domainClusterId"=EXCLUDED."domainClusterId", "coverageSlot"=EXCLUDED."coverageSlot", "objective"=EXCLUDED."objective", "approvedProducts"=EXCLUDED."approvedProducts", "forbiddenProducts"=EXCLUDED."forbiddenProducts", "targetNutrition"=EXCLUDED."targetNutrition", "targetCost"=EXCLUDED."targetCost", "targetCookTime"=EXCLUDED."targetCookTime", "allowedEquipment"=EXCLUDED."allowedEquipment", "requiredTechniques"=EXCLUDED."requiredTechniques", "optionalTechniques"=EXCLUDED."optionalTechniques", "requiredFacts"=EXCLUDED."requiredFacts", "conflictingFacts"=EXCLUDED."conflictingFacts", "unresolvedFacts"=EXCLUDED."unresolvedFacts", "differentiationReason"=EXCLUDED."differentiationReason", "evidenceSummary"=EXCLUDED."evidenceSummary", "status"=EXCLUDED."status", "approvalState"=EXCLUDED."approvalState", "updatedAt"=now()`,
      [briefIdToStorageUuid(brief.briefId), brief.briefVersion, toUuid(brief.clusterId), brief.clusterId, brief.coverageSlot, brief.objective, json(brief.approvedProducts), json(brief.forbiddenProducts), brief.targetNutrition == null ? null : json(brief.targetNutrition), brief.targetCost ?? null, brief.targetCookTime ?? null, json(brief.allowedEquipment), json(brief.requiredTechniques), json(brief.optionalTechniques), json(brief.requiredFacts), json(brief.conflictingFacts), json(brief.unresolvedFacts), brief.differentiationReason, json({ ...brief.evidenceSummary, deterministicSelections: brief.deterministicSelections ?? [], ownerDecisions: brief.ownerDecisions ?? {}, exclusions: brief.exclusions ?? [], servings: brief.servings ?? null, totalTimeMinutes: brief.totalTimeMinutes ?? null }), preApprovalStatus, preApprovalState],
    );
  }

  async loadBrief(briefId: string): Promise<SynthesisBrief | null> {
    const result = await this.db.query<Record<string, unknown>>(`SELECT * FROM "RecipeSynthesisBrief" WHERE "id"=$1::uuid`, [briefIdToStorageUuid(briefId)]);
    const row = result.rows[0] as any;
    if (!row) return null;
    return mapRecipeSynthesisBriefRow(briefId, row);
  }
}

function json(value: unknown): string { return JSON.stringify(value); }

/** Domain ids are deterministic labels; persistence keeps UUID columns isolated from that public identity. */
function toUuid(value: string): string {
  const hex = value.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
