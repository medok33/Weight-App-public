/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';

/**
 * Single canonical reconstruction boundary for persisted synthesis briefs.
 * `clusterId` in PostgreSQL is an opaque UUID FK; the hash-bound domain identity
 * is stored separately as `domainClusterId` and must never be inferred from it.
 */
export function mapRecipeSynthesisBriefRow(briefId: string, row: Record<string, unknown>): SynthesisBrief {
  const domainClusterId = typeof row.domainClusterId === 'string' ? row.domainClusterId.trim() : '';
  if (!domainClusterId) throw new Error('BRIEF_DOMAIN_CLUSTER_ID_MISSING');
  const storedEvidence = (row.evidenceSummary ?? {}) as Record<string, unknown>;
  // These fields are denormalized into the JSON column for storage compatibility,
  // but are separate hash-bound fields in the domain contract. Returning them in
  // evidenceSummary as well changes the content hash after a persistence round trip.
  const {
    deterministicSelections = [],
    ownerDecisions = {},
    exclusions = [],
    servings = null,
    totalTimeMinutes = null,
    ...evidence
  } = storedEvidence;
  return {
    briefId,
    briefVersion: String(row.briefVersion),
    clusterId: domainClusterId,
    coverageSlot: row.coverageSlot as string | null,
    objective: String(row.objective),
    approvedProducts: (row.approvedProducts ?? []) as string[],
    forbiddenProducts: (row.forbiddenProducts ?? []) as string[],
    targetNutrition: row.targetNutrition as Record<string, number> | null,
    targetCost: row.targetCost as number | null,
    targetCookTime: row.targetCookTime as number | null,
    allowedEquipment: (row.allowedEquipment ?? []) as string[],
    requiredTechniques: (row.requiredTechniques ?? []) as string[],
    optionalTechniques: (row.optionalTechniques ?? []) as string[],
    requiredFacts: (row.requiredFacts ?? []) as string[],
    conflictingFacts: (row.conflictingFacts ?? []) as string[],
    unresolvedFacts: (row.unresolvedFacts ?? []) as string[],
    differentiationReason: String(row.differentiationReason),
    evidenceSummary: evidence as any,
    status: row.status as SynthesisBrief['status'],
    approvalState: row.approvalState as SynthesisBrief['approvalState'],
    deterministicSelections: deterministicSelections as SynthesisBrief['deterministicSelections'],
    ownerDecisions: ownerDecisions as Record<string, string>,
    exclusions: exclusions as string[],
    servings: servings as number | null,
    totalTimeMinutes: totalTimeMinutes as number | null,
  };
}
