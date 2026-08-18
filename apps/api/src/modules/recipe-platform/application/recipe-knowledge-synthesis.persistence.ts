import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { DishConceptCluster, RecipeResearchFact, SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';

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
    await this.db.query(
      `INSERT INTO "RecipeSynthesisBrief" ("id", "briefVersion", "clusterId", "coverageSlot", "objective", "approvedProducts", "forbiddenProducts", "targetNutrition", "targetCost", "targetCookTime", "allowedEquipment", "requiredTechniques", "optionalTechniques", "requiredFacts", "conflictingFacts", "unresolvedFacts", "differentiationReason", "evidenceSummary", "status", "approvalState")
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18::jsonb, $19, $20)`,
      [toUuid(brief.briefId), brief.briefVersion, toUuid(brief.clusterId), brief.coverageSlot, brief.objective, json(brief.approvedProducts), json(brief.forbiddenProducts), brief.targetNutrition == null ? null : json(brief.targetNutrition), brief.targetCost ?? null, brief.targetCookTime ?? null, json(brief.allowedEquipment), json(brief.requiredTechniques), json(brief.optionalTechniques), json(brief.requiredFacts), json(brief.conflictingFacts), json(brief.unresolvedFacts), brief.differentiationReason, json(brief.evidenceSummary), brief.status, brief.approvalState],
    );
  }
}

function json(value: unknown): string { return JSON.stringify(value); }

/** Domain ids are deterministic labels; persistence keeps UUID columns isolated from that public identity. */
function toUuid(value: string): string {
  const hex = value.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
