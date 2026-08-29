import { createHash } from 'node:crypto';
import { normalizeFoodText, stableJson, stableJsonChecksum } from './recipe-research.policy';

export const KNOWLEDGE_SYNTHESIS_VERSION = 'recipe-knowledge-synthesis/v1';
export const SOURCE_CANDIDATE_CAN_PUBLISH_DIRECTLY = false;
export const SOURCE_QUALITY_CAN_OVERRIDE_POLICY = false;
export const SINGLE_SOURCE_CLONE_PATH_BLOCKED = true;
export const CHEF_EDITOR_FUTURE_INPUT_IS_STRUCTURED_BRIEF = true;
export const FINAL_GRAMMAGE_AUTHORITY = 'CODE' as const;
export const AI_FINAL_GRAMMAGE_AUTHORITY = false;

export type ResearchCandidate = {
  candidateId: string;
  sourceCode: string;
  sourceLineage?: string | null;
  title: string;
  conceptKey?: string | null;
  rightsStatus: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'DISABLED';
  ingredients: Array<{ productId?: string | null; name: string; role?: string | null; quantity?: number | null; unit?: string | null }>;
  techniques?: Array<string | null>;
  steps?: Array<{ ordinal: number; normalizedTechnique?: string | null; durationMinutes?: number | null; temperatureC?: number | null; qualitativeEndCondition?: string | null; sourceText?: string | null; ingredientRefs?: Array<{ ingredientIndex: number; confidence: IngredientStepReferenceConfidence }> }>;
  servings?: number | null;
  preparationTime?: number | null;
  cookingTime?: number | null;
  temperatures?: string[];
  equipment?: string[];
  categories?: string[];
  slotHints?: string[];
  provenance?: { sourceUrl?: string | null; rawSnapshotHash?: string | null; parserVersion?: string | null; normalizedAt?: string | null };
  parseConfidence?: number;
  normalizationConfidence?: number;
};

export type IngredientStepReferenceConfidence = 'EXACT' | 'NORMALIZED_MATCH' | 'STEM_MATCH' | 'IMPLICIT' | 'UNRESOLVED';
export type FactType = 'INGREDIENT_ROLE' | 'INGREDIENT_RATIO' | 'TECHNIQUE' | 'TECHNIQUE_ORDER' | 'DURATION' | 'DURATION_RANGE' | 'TEMPERATURE' | 'TEMPERATURE_RANGE' | 'RELATIVE_HEAT' | 'EQUIPMENT' | 'YIELD' | 'PORTION' | 'OPTIONAL_INGREDIENT' | 'SUBSTITUTION' | 'QUALITATIVE_END_CONDITION' | 'SLOT_SUITABILITY';
export type ConflictLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type ScoreBreakdown = { score: number; reasons: string[]; evidence: Record<string, number | boolean | string> };
export type DishConceptCluster = {
  clusterId: string;
  clusterVersion: string;
  conceptKey: string;
  displayLabel: string;
  candidateIds: string[];
  sourceCount: number;
  sourceCodes: string[];
  representativeCandidateId: string;
  ingredientSignature: string[];
  techniqueSignature: string[];
  slotHints: string[];
  fingerprint: string;
  sourceQualityScore: ScoreBreakdown;
  weightAppFitScore: ScoreBreakdown;
  status: 'ACTIVE' | 'CLUSTER_REVIEW_REQUIRED';
  createdAt: string;
  updatedAt: string;
};

export type RecipeResearchFact = {
  factId: string;
  clusterId: string;
  factType: FactType;
  normalizedValue: string;
  unit: string | null;
  supportingCandidateIds: string[];
  supportingSourceCodes: string[];
  supportingCandidateCount: number;
  confidence: number;
  conflictLevel: ConflictLevel;
  requiresReview: boolean;
  provenance: Array<{ candidateId: string; sourceCode: string; sourceUrl: string | null; rawSnapshotHash: string | null }>;
  derivedAt: string;
};

export type SynthesisBrief = {
  briefId: string;
  briefVersion: string;
  clusterId: string;
  coverageSlot: string | null;
  objective: string;
  approvedProducts: string[];
  forbiddenProducts: string[];
  targetNutrition?: Record<string, number> | null;
  targetCost?: number | null;
  targetCookTime?: number | null;
  allowedEquipment: string[];
  requiredTechniques: string[];
  optionalTechniques: string[];
  requiredFacts: string[];
  conflictingFacts: string[];
  unresolvedFacts: string[];
  differentiationReason: string;
  evidenceSummary: { candidateIds: string[]; sourceCodes: string[]; factIds: string[]; rejectedFactIds: string[]; conflictLevels: ConflictLevel[]; scores: { sourceQuality: number; weightAppFit: number }; ingredientStepEvidence?: unknown };
  status: 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED_FOR_SYNTHESIS' | 'BLOCKED_CONFLICT' | 'REJECTED';
  approvalState: 'PENDING' | 'OWNER_APPROVED' | 'SYSTEM_BLOCKED';
  /** Deterministic selection snapshot and content hash are populated before any Editor call. */
  deterministicSelections?: Array<{ sourceLabel: string; productId: string | null; quantity: number | null; unit: string | null; role: string; optional: boolean; authority: string }>;
  ownerDecisions?: Record<string, string>;
  exclusions?: string[];
  servings?: number | null;
  totalTimeMinutes?: number | null;
  contentHash?: string;
};

export type GrammageConstraint = { productId: string; role: string; minGrams: number; maxGrams: number; targetGrams?: number | null; stepGrams: number; fixed?: boolean; required?: boolean; reason: string; sourceFactIds: string[] };
export type GrammagePlan = { version: string; briefId: string; servingCount: number; ingredients: Array<GrammageConstraint & { grams: number }>; checksum: string };

function clamp(value: number): number { return Math.max(0, Math.min(1, Number(value.toFixed(6)))); }
function sortedUnique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function normalizedIngredients(candidate: ResearchCandidate): string[] { return sortedUnique(candidate.ingredients.map((i) => `${i.productId ?? normalizeFoodText(i.name)}:${i.role ?? 'UNSPECIFIED'}`)); }
function normalizedTechniques(candidate: ResearchCandidate): string[] { return sortedUnique([...(candidate.techniques ?? []), ...(candidate.steps ?? []).map((s) => s.normalizedTechnique ?? '')].map((x) => normalizeFoodText(String(x)))); }
function conceptIdentity(candidate: ResearchCandidate): string { return normalizeFoodText(candidate.conceptKey ?? candidate.title); }
function scoreReason(label: string, value: number): string { return `${label}=${Number(value.toFixed(3))}`; }

export function clusterFingerprint(candidates: ResearchCandidate[]): string {
  const ordered = [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  if (!ordered.length) throw new Error('DISH_CLUSTER_EMPTY');
  const identity = conceptIdentity(ordered[0]!);
  if (ordered.some((candidate) => conceptIdentity(candidate) !== identity)) throw new Error('DISH_CLUSTER_CONCEPT_MISMATCH');
  return stableJsonChecksum({ version: KNOWLEDGE_SYNTHESIS_VERSION, conceptKey: identity, ingredients: sortedUnique(ordered.flatMap(normalizedIngredients)), techniques: sortedUnique(ordered.flatMap(normalizedTechniques)), slots: sortedUnique(ordered.flatMap((c) => c.slotHints ?? [])) });
}

export function sourceQualityScore(candidate: ResearchCandidate, supportCount = 1): ScoreBreakdown {
  const structured = candidate.ingredients.length > 0 ? 1 : 0;
  const quantities = candidate.ingredients.length === 0 ? 0 : candidate.ingredients.filter((i) => i.quantity != null && i.unit).length / candidate.ingredients.length;
  const orderedSteps = (candidate.steps?.length ?? 0) > 0 ? 1 : 0;
  const time = candidate.preparationTime != null || candidate.cookingTime != null ? 1 : 0;
  const temperature = (candidate.temperatures?.length ?? 0) > 0 || (candidate.steps ?? []).some((s) => s.temperatureC != null) ? 1 : 0;
  const provenance = candidate.provenance?.sourceUrl && candidate.provenance.rawSnapshotHash ? 1 : 0.25;
  const parse = clamp(candidate.parseConfidence ?? 0.5);
  const normalization = clamp(candidate.normalizationConfidence ?? 0.5);
  const diversity = supportCount > 1 ? 1 : 0.4;
  const score = clamp(structured * 0.18 + quantities * 0.16 + orderedSteps * 0.16 + time * 0.1 + temperature * 0.06 + provenance * 0.16 + parse * 0.1 + normalization * 0.06 + diversity * 0.02);
  return { score, reasons: [scoreReason('structuredIngredients', structured), scoreReason('quantityCompleteness', quantities), scoreReason('orderedSteps', orderedSteps), scoreReason('timeEvidence', time), scoreReason('temperatureEvidence', temperature), scoreReason('provenance', provenance), scoreReason('parseConfidence', parse), scoreReason('normalizationConfidence', normalization), scoreReason('sourceDiversity', diversity)], evidence: { structured, quantities, orderedSteps, time, temperature, provenance, parse, normalization, diversity } };
}

export function weightAppFitScore(candidate: ResearchCandidate): ScoreBreakdown {
  const mapped = candidate.ingredients.length === 0 ? 0 : candidate.ingredients.filter((i) => Boolean(i.productId)).length / candidate.ingredients.length;
  const measurable = candidate.ingredients.length === 0 ? 0 : candidate.ingredients.filter((i) => i.quantity != null && i.unit).length / candidate.ingredients.length;
  const yieldScore = candidate.servings && candidate.servings > 0 ? 1 : 0;
  const timeScore = candidate.preparationTime != null || candidate.cookingTime != null ? 1 : 0.5;
  const slot = (candidate.slotHints?.length ?? 0) > 0 ? 1 : 0.5;
  const complexity = candidate.ingredients.length <= 8 ? 1 : candidate.ingredients.length <= 14 ? 0.7 : 0.35;
  const score = clamp(mapped * 0.28 + measurable * 0.22 + yieldScore * 0.15 + timeScore * 0.12 + slot * 0.1 + complexity * 0.08 + (candidate.equipment?.length ? 0.05 : 0));
  return { score, reasons: [scoreReason('productMapping', mapped), scoreReason('measurableQuantities', measurable), scoreReason('yieldResolvable', yieldScore), scoreReason('cookTime', timeScore), scoreReason('slotSuitability', slot), scoreReason('ingredientComplexity', complexity)], evidence: { mapped, measurable, yieldScore, timeScore, slot, complexity } };
}

export function buildDishConceptCluster(candidates: ResearchCandidate[], now = new Date().toISOString()): DishConceptCluster {
  if (!candidates.length) throw new Error('DISH_CLUSTER_EMPTY');
  const fingerprint = clusterFingerprint(candidates);
  const ordered = [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const first = ordered[0]!;
  const sourceCodes = sortedUnique(ordered.map((c) => c.sourceCode));
  const sourceCount = new Set(ordered.map((c) => c.sourceLineage ?? c.sourceCode)).size;
  const status = sourceCount < 2 ? 'CLUSTER_REVIEW_REQUIRED' : 'ACTIVE';
  const avgQuality = ordered.reduce((sum, c) => sum + sourceQualityScore(c, sourceCount).score, 0) / ordered.length;
  const avgFit = ordered.reduce((sum, c) => sum + weightAppFitScore(c).score, 0) / ordered.length;
  return { clusterId: `dcluster_${fingerprint.slice(0, 24)}`, clusterVersion: KNOWLEDGE_SYNTHESIS_VERSION, conceptKey: conceptIdentity(first), displayLabel: first.title.trim(), candidateIds: ordered.map((c) => c.candidateId), sourceCount, sourceCodes, representativeCandidateId: ordered[0]!.candidateId, ingredientSignature: sortedUnique(ordered.flatMap(normalizedIngredients)), techniqueSignature: sortedUnique(ordered.flatMap(normalizedTechniques)), slotHints: sortedUnique(ordered.flatMap((c) => c.slotHints ?? [])), fingerprint, sourceQualityScore: { score: clamp(avgQuality), reasons: [`candidateCount=${ordered.length}`, `distinctSourceLineage=${sourceCount}`], evidence: { candidateCount: ordered.length, distinctSourceLineage: sourceCount } }, weightAppFitScore: { score: clamp(avgFit), reasons: [`candidateCount=${ordered.length}`], evidence: { candidateCount: ordered.length } }, status, createdAt: now, updatedAt: now };
}

export function aggregateResearchFacts(cluster: DishConceptCluster, candidates: ResearchCandidate[], derivedAt = new Date().toISOString()): RecipeResearchFact[] {
  const facts = new Map<string, { type: FactType; value: string; unit: string | null; candidateIds: string[]; sources: string[]; provenance: RecipeResearchFact['provenance'] }>();
  for (const candidate of candidates) {
    for (const step of candidate.steps ?? []) {
      if (step.normalizedTechnique) addFact(facts, 'TECHNIQUE', normalizeFoodText(step.normalizedTechnique), null, candidate);
      if (step.durationMinutes != null) addFact(facts, 'DURATION', String(step.durationMinutes), 'minutes', candidate);
      if (step.temperatureC != null) addFact(facts, 'TEMPERATURE', String(step.temperatureC), 'C', candidate);
      if (step.qualitativeEndCondition) addFact(facts, 'QUALITATIVE_END_CONDITION', normalizeFoodText(step.qualitativeEndCondition), null, candidate);
    }
    for (const ingredient of candidate.ingredients) if (ingredient.role) addFact(facts, 'INGREDIENT_ROLE', `${ingredient.productId ?? normalizeFoodText(ingredient.name)}:${normalizeFoodText(ingredient.role)}`, null, candidate);
  }
  const grouped = [...facts.entries()];
  return grouped.map(([key, value]) => {
    const sameType = grouped.filter(([, other]) => other.type === value.type);
    const conflict = detectConflictLevel(value.type, value.value, sameType.map(([, other]) => other.value));
    const distinctSources = sortedUnique(value.sources);
    const confidence = clamp((value.candidateIds.length * 0.2) + (distinctSources.length * 0.2) + 0.2);
    return { factId: `fact_${stableJsonChecksum({ cluster: cluster.clusterId, key }).slice(0, 24)}`, clusterId: cluster.clusterId, factType: value.type, normalizedValue: value.value, unit: value.unit, supportingCandidateIds: sortedUnique(value.candidateIds), supportingSourceCodes: distinctSources, supportingCandidateCount: value.candidateIds.length, confidence, conflictLevel: conflict, requiresReview: conflict === 'HIGH' || conflict === 'MEDIUM', provenance: value.provenance, derivedAt };
  });
}

function addFact(map: Map<string, { type: FactType; value: string; unit: string | null; candidateIds: string[]; sources: string[]; provenance: RecipeResearchFact['provenance'] }>, type: FactType, value: string, unit: string | null, candidate: ResearchCandidate) {
  const key = `${type}:${value}:${unit ?? ''}`;
  const existing = map.get(key) ?? { type, value, unit, candidateIds: [], sources: [], provenance: [] };
  existing.candidateIds.push(candidate.candidateId); existing.sources.push(candidate.sourceCode); existing.provenance.push({ candidateId: candidate.candidateId, sourceCode: candidate.sourceCode, sourceUrl: candidate.provenance?.sourceUrl ?? null, rawSnapshotHash: candidate.provenance?.rawSnapshotHash ?? null }); map.set(key, existing);
}

function detectConflictLevel(type: FactType, value: string, values: string[]): ConflictLevel {
  const peers = values.filter((v) => v !== value);
  if (!peers.length) return 'NONE';
  if (type === 'TEMPERATURE' || type === 'DURATION') {
    const current = Number(value); const numericPeers = peers.map(Number).filter(Number.isFinite);
    if (Number.isFinite(current) && numericPeers.some((p) => Math.abs(p - current) >= (type === 'TEMPERATURE' ? 20 : 30))) return 'HIGH';
    return 'LOW';
  }
  // Multiple techniques, roles, equipment and end conditions are additive
  // evidence, not mutually exclusive alternatives. Only numeric ranges above
  // are treated as conflicts by the deterministic research layer.
  return 'NONE';
}

export function resolveFactConflicts(facts: RecipeResearchFact[]): { facts: RecipeResearchFact[]; requiresReview: boolean } {
  const high = facts.some((fact) => fact.conflictLevel === 'HIGH');
  return { facts: facts.map((fact) => ({ ...fact, requiresReview: fact.requiresReview || fact.conflictLevel === 'HIGH' })), requiresReview: high };
}

export function buildSynthesisBrief(input: { cluster: DishConceptCluster; facts: RecipeResearchFact[]; objective: string; coverageSlot?: string | null; approvedProducts: string[]; forbiddenProducts?: string[]; targetNutrition?: Record<string, number> | null; targetCost?: number | null; targetCookTime?: number | null; allowedEquipment?: string[]; }): SynthesisBrief {
  if (input.cluster.candidateIds.length < 2 || input.cluster.sourceCount < 2) throw new Error('SINGLE_SOURCE_CLONE_PATH_BLOCKED');
  const { facts, requiresReview } = resolveFactConflicts(input.facts);
  const conflictingFacts = facts.filter((f) => f.requiresReview).map((f) => f.factId);
  const unresolvedFacts = facts.filter((f) => f.confidence < 0.5).map((f) => f.factId);
  const status = requiresReview ? 'BLOCKED_CONFLICT' : conflictingFacts.length || unresolvedFacts.length ? 'READY_FOR_REVIEW' : 'DRAFT';
  const sourceCodes = sortedUnique(facts.flatMap((f) => f.supportingSourceCodes));
  const briefId = `brief_${stableJsonChecksum({ cluster: input.cluster.clusterId, facts: facts.map((f) => f.factId), objective: input.objective }).slice(0, 24)}`;
  return { briefId, briefVersion: KNOWLEDGE_SYNTHESIS_VERSION, clusterId: input.cluster.clusterId, coverageSlot: input.coverageSlot ?? null, objective: input.objective, approvedProducts: sortedUnique(input.approvedProducts), forbiddenProducts: sortedUnique(input.forbiddenProducts ?? []), targetNutrition: input.targetNutrition ?? null, targetCost: input.targetCost ?? null, targetCookTime: input.targetCookTime ?? null, allowedEquipment: sortedUnique(input.allowedEquipment ?? []), requiredTechniques: facts.filter((f) => f.factType === 'TECHNIQUE' && !f.requiresReview).map((f) => f.normalizedValue), optionalTechniques: [], requiredFacts: facts.filter((f) => !f.requiresReview && f.confidence >= 0.5).map((f) => f.factId), conflictingFacts, unresolvedFacts, differentiationReason: `synthesized_from_${input.cluster.candidateIds.length}_candidates`, evidenceSummary: { candidateIds: input.cluster.candidateIds, sourceCodes, factIds: facts.map((f) => f.factId), rejectedFactIds: [], conflictLevels: sortedUnique(facts.map((f) => f.conflictLevel)) as ConflictLevel[], scores: { sourceQuality: input.cluster.sourceQualityScore.score, weightAppFit: input.cluster.weightAppFitScore.score } }, status, approvalState: requiresReview ? 'SYSTEM_BLOCKED' : 'PENDING' };
}

export function planDeterministicGrammage(input: { brief: SynthesisBrief; servingCount: number; constraints: GrammageConstraint[]; seed?: string }): GrammagePlan {
  if (input.servingCount <= 0 || !Number.isInteger(input.servingCount)) throw new Error('GRAMMAGE_SERVINGS_INVALID');
  if (input.brief.status === 'BLOCKED_CONFLICT' || input.brief.approvalState === 'SYSTEM_BLOCKED') throw new Error('GRAMMAGE_BRIEF_BLOCKED');
  const ingredients = [...input.constraints].sort((a, b) => `${a.role}:${a.productId}`.localeCompare(`${b.role}:${b.productId}`)).map((constraint) => {
    if (!constraint.productId || constraint.minGrams < 0 || constraint.maxGrams < constraint.minGrams || constraint.stepGrams <= 0) throw new Error('GRAMMAGE_CONSTRAINT_INVALID');
    const target = constraint.targetGrams ?? constraint.minGrams;
    const bounded = Math.max(constraint.minGrams, Math.min(constraint.maxGrams, target));
    const steps = Math.round((bounded - constraint.minGrams) / constraint.stepGrams);
    const grams = Number((constraint.minGrams + steps * constraint.stepGrams).toFixed(4));
    return { ...constraint, grams };
  });
  const checksum = createHash('sha256').update(stableJson({ version: KNOWLEDGE_SYNTHESIS_VERSION, briefId: input.brief.briefId, servingCount: input.servingCount, seed: input.seed ?? 'default', ingredients })).digest('hex');
  return { version: KNOWLEDGE_SYNTHESIS_VERSION, briefId: input.brief.briefId, servingCount: input.servingCount, ingredients, checksum };
}
