import { createHash } from 'node:crypto';
import type { SynthesisBrief } from './recipe-knowledge-synthesis.policy';

export const BRIEF_CONTENT_HASH_VERSION = 1 as const;
export type BriefApprovalDecision = 'APPROVE' | 'REJECT';

export type DeterministicBriefSelection = {
  sourceLabel: string;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  role: string;
  optional: boolean;
  authority: string;
};

export type BriefApprovalRecord = {
  briefId: string;
  briefContentHash: string;
  decision: BriefApprovalDecision;
  actorId: string;
  approvedAt: string;
};

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).sort().join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function briefContentPayload(brief: SynthesisBrief & { deterministicSelections?: DeterministicBriefSelection[]; ownerDecisions?: Record<string, string>; exclusions?: string[]; servings?: number | null; totalTimeMinutes?: number | null }): Record<string, unknown> {
  return {
    version: BRIEF_CONTENT_HASH_VERSION,
    briefId: brief.briefId,
    clusterId: brief.clusterId,
    briefVersion: brief.briefVersion,
    objective: brief.objective,
    coverageSlot: brief.coverageSlot,
    approvedProducts: brief.approvedProducts,
    forbiddenProducts: brief.forbiddenProducts,
    deterministicSelections: brief.deterministicSelections ?? [],
    ownerDecisions: brief.ownerDecisions ?? {},
    exclusions: brief.exclusions ?? [],
    servings: brief.servings ?? null,
    totalTimeMinutes: brief.totalTimeMinutes ?? null,
    requiredTechniques: brief.requiredTechniques,
    optionalTechniques: brief.optionalTechniques,
    requiredFacts: brief.requiredFacts,
    conflictingFacts: brief.conflictingFacts,
    unresolvedFacts: brief.unresolvedFacts,
    allowedEquipment: brief.allowedEquipment,
    evidenceSummary: brief.evidenceSummary,
  };
}

export function computeBriefContentHash(brief: SynthesisBrief & { deterministicSelections?: DeterministicBriefSelection[]; ownerDecisions?: Record<string, string>; exclusions?: string[]; servings?: number | null; totalTimeMinutes?: number | null }): string {
  return createHash('sha256').update(canonicalize(briefContentPayload(brief))).digest('hex');
}

export function isApprovalForCurrentBrief(brief: SynthesisBrief & { contentHash?: string }, record: BriefApprovalRecord | null): boolean {
  return Boolean(record && record.decision === 'APPROVE' && record.briefId === brief.briefId && record.briefContentHash === computeBriefContentHash(brief));
}

