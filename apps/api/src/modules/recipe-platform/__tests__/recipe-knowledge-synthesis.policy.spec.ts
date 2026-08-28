import { describe, expect, it } from 'vitest';
import { buildDishConceptCluster, buildSynthesisBrief, clusterFingerprint, planDeterministicGrammage, sourceQualityScore, weightAppFitScore, aggregateResearchFacts, SOURCE_CANDIDATE_CAN_PUBLISH_DIRECTLY } from '../domain/recipe-knowledge-synthesis.policy';
import type { ResearchCandidate } from '../domain/recipe-knowledge-synthesis.policy';

const candidate = (id: string, sourceCode: string, overrides: Partial<ResearchCandidate> = {}): ResearchCandidate => ({ candidateId: id, sourceCode, sourceLineage: sourceCode, title: 'Сырники', conceptKey: 'сырники', rightsStatus: 'APPROVED', ingredients: [{ productId: 'curd', name: 'Творог', role: 'base', quantity: 400, unit: 'g' }, { productId: 'egg', name: 'Яйцо', role: 'binder', quantity: 1, unit: 'pcs' }], techniques: ['MIX', 'FRY'], steps: [{ ordinal: 1, normalizedTechnique: 'MIX', durationMinutes: null, temperatureC: null }, { ordinal: 2, normalizedTechnique: 'FRY', durationMinutes: 8, temperatureC: 180 }], servings: 2, cookingTime: 8, temperatures: ['180 C'], equipment: ['PAN'], slotHints: ['BREAKFAST'], provenance: { sourceUrl: `https://${sourceCode}.test/r/${id}`, rawSnapshotHash: `hash-${id}` }, parseConfidence: 0.9, normalizationConfidence: 0.9, ...overrides });

describe('STEP-322–328 recipe knowledge synthesis foundation', () => {
  it('clusters multiple candidates deterministically and keeps lineage distinct', () => {
    const input = [candidate('a', 'iamcook'), candidate('b', 'russianfood')];
    const one = buildDishConceptCluster(input, '2026-08-18T00:00:00.000Z');
    const two = buildDishConceptCluster([...input].reverse(), '2026-08-18T00:00:00.000Z');
    expect(one.clusterId).toBe(two.clusterId);
    expect(one.candidateIds).toEqual(['a', 'b']);
    expect(one.sourceCount).toBe(2);
    expect(one.status).toBe('ACTIVE');
    expect(clusterFingerprint(input)).toBe(clusterFingerprint([...input].reverse()));
  });

  it('does not merge unrelated concepts', () => {
    expect(() => buildDishConceptCluster([candidate('a', 'iamcook'), candidate('fish', 'russianfood', { title: 'Рыбный суп', conceptKey: 'рыбный суп' })])).toThrow('DISH_CLUSTER_CONCEPT_MISMATCH');
  });

  it('exposes stable explainable scores and quality never overrides rights policy', () => {
    const c = candidate('a', 'iamcook', { rightsStatus: 'PENDING_REVIEW' });
    expect(sourceQualityScore(c)).toEqual(sourceQualityScore(c));
    expect(weightAppFitScore(c)).toEqual(weightAppFitScore(c));
    expect(sourceQualityScore(c).reasons.length).toBeGreaterThan(3);
    expect(SOURCE_CANDIDATE_CAN_PUBLISH_DIRECTLY).toBe(false);
  });

  it('aggregates provenance-backed facts, preserves qualitative conditions and detects conflicts', () => {
    const cluster = buildDishConceptCluster([candidate('a', 'iamcook'), candidate('b', 'russianfood', { steps: [{ ordinal: 1, normalizedTechnique: 'BAKE', durationMinutes: 40, temperatureC: 220, qualitativeEndCondition: 'до румяной корочки' }] })]);
    const facts = aggregateResearchFacts(cluster, [candidate('a', 'iamcook'), candidate('b', 'russianfood', { steps: [{ ordinal: 1, normalizedTechnique: 'BAKE', durationMinutes: 40, temperatureC: 220, qualitativeEndCondition: 'до румяной корочки' }] })]);
    expect(facts.some((f) => f.factType === 'QUALITATIVE_END_CONDITION' && f.normalizedValue.includes('румяной'))).toBe(true);
    expect(facts.some((f) => f.factType === 'TEMPERATURE' && f.conflictLevel === 'HIGH')).toBe(true);
    expect(facts.every((f) => f.supportingSourceCodes.length >= 1 && f.provenance.length >= 1)).toBe(true);
  });

  it('blocks single-source clone and produces structured brief for multi-source evidence', () => {
    const single = buildDishConceptCluster([candidate('a', 'iamcook')]);
    expect(() => buildSynthesisBrief({ cluster: single, facts: [], objective: 'breakfast', approvedProducts: ['curd'] })).toThrow('SINGLE_SOURCE_CLONE_PATH_BLOCKED');
    const candidates = [candidate('a', 'iamcook'), candidate('b', 'russianfood')];
    const cluster = buildDishConceptCluster(candidates);
    const brief = buildSynthesisBrief({ cluster, facts: aggregateResearchFacts(cluster, candidates), objective: 'breakfast', coverageSlot: 'BREAKFAST', approvedProducts: ['curd', 'egg'], allowedEquipment: ['PAN'] });
    expect(brief.briefId).toMatch(/^brief_/);
    expect(brief.evidenceSummary.candidateIds).toEqual(['a', 'b']);
    expect(brief.differentiationReason).toContain('synthesized_from_2');
    expect(brief).not.toHaveProperty('rawSourceText');
  });

  it('generates deterministic bounded grammage with optional semantics and fail-closed invalid mapping', () => {
    const candidates = [candidate('a', 'iamcook'), candidate('b', 'russianfood')];
    const cluster = buildDishConceptCluster(candidates);
    const brief = buildSynthesisBrief({ cluster, facts: aggregateResearchFacts(cluster, candidates), objective: 'breakfast', approvedProducts: ['curd', 'egg'] });
    const constraints = [{ productId: 'curd', role: 'base', minGrams: 200, maxGrams: 500, targetGrams: 400, stepGrams: 10, required: true, reason: 'base', sourceFactIds: [] }, { productId: 'egg', role: 'binder', minGrams: 40, maxGrams: 120, targetGrams: 80, stepGrams: 10, required: false, reason: 'binder', sourceFactIds: [] }];
    const first = planDeterministicGrammage({ brief, servingCount: 2, constraints, seed: 'v1' });
    const second = planDeterministicGrammage({ brief, servingCount: 2, constraints, seed: 'v1' });
    expect(first).toEqual(second);
    expect(first.ingredients.every((i) => i.grams >= i.minGrams && i.grams <= i.maxGrams)).toBe(true);
    expect(() => planDeterministicGrammage({ brief, servingCount: 2, constraints: [{ ...constraints[0]!, productId: '' }] })).toThrow('GRAMMAGE_CONSTRAINT_INVALID');
  });
});
