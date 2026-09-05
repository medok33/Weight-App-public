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
  const hasColumn = (key: string) => Object.prototype.hasOwnProperty.call(row, key) && row[key] !== null && row[key] !== undefined;
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
    evidenceSummary: storedEvidence as any,
    status: row.status as SynthesisBrief['status'],
    approvalState: row.approvalState as SynthesisBrief['approvalState'],
    deterministicSelections: (hasColumn('deterministicSelections') ? row.deterministicSelections : storedEvidence.deterministicSelections ?? []) as SynthesisBrief['deterministicSelections'],
    ownerDecisions: (hasColumn('ownerDecisions') ? row.ownerDecisions : storedEvidence.ownerDecisions ?? {}) as Record<string, string>,
    exclusions: (hasColumn('exclusions') ? row.exclusions : storedEvidence.exclusions ?? []) as string[],
    servings: (hasColumn('servings') ? row.servings : storedEvidence.servings ?? null) as number | null,
    totalTimeMinutes: (hasColumn('totalTimeMinutes') ? row.totalTimeMinutes : storedEvidence.totalTimeMinutes ?? null) as number | null,
  };
}
