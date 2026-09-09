import { describe, expect, it } from 'vitest';
import { buildDishConceptCluster, buildSynthesisBrief, clusterFingerprint, planDeterministicGrammage, sourceQualityScore, weightAppFitScore, aggregateResearchFacts, selectCanonicalDonor, SOURCE_CANDIDATE_CAN_PUBLISH_DIRECTLY } from '../domain/recipe-knowledge-synthesis.policy';
import type { ResearchCandidate } from '../domain/recipe-knowledge-synthesis.policy';

const candidate = (id: string, sourceCode: string, overrides: Partial<ResearchCandidate> = {}): ResearchCandidate => ({ candidateId: id, sourceCode, sourceLineage: sourceCode, title: 'Сырники', conceptKey: 'сырники', rightsStatus: 'APPROVED', ingredients: [{ productId: 'curd', name: 'Творог', role: 'base', quantity: 400, unit: 'g', sourceIngredientOrdinal: 1, sourceClassification: 'LIKELY_FOOD' }, { productId: 'egg', name: 'Яйцо', role: 'binder', quantity: 1, unit: 'pcs', sourceIngredientOrdinal: 2, sourceClassification: 'LIKELY_FOOD' }], sourceIngredientCount: 2, techniques: ['MIX', 'FRY'], steps: [{ ordinal: 1, normalizedTechnique: 'MIX', durationMinutes: null, temperatureC: null }, { ordinal: 2, normalizedTechnique: 'FRY', durationMinutes: 8, temperatureC: 180 }], servings: 2, cookingTime: 8, temperatures: ['180 C'], equipment: ['PAN'], slotHints: ['BREAKFAST'], provenance: { sourceUrl: `https://${sourceCode}.test/r/${id}`, rawSnapshotHash: `hash-${id}` }, parseConfidence: 0.9, normalizationConfidence: 0.9, ...overrides });

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

  it('selects one complete donor deterministically and is independent of input order', () => {
    const weaker = candidate('b', 'russianfood', { ingredients: [{ productId: 'curd', name: 'Творог', role: 'base', quantity: null, unit: null, sourceIngredientOrdinal: 1, sourceClassification: 'LIKELY_FOOD' }] });
    const stronger = candidate('a', 'iamcook');
    const first = selectCanonicalDonor([weaker, stronger]);
    const second = selectCanonicalDonor([stronger, weaker]);
    expect(first.state).toBe('CANONICAL_DONOR_SELECTED');
    expect(first.donor?.candidateId).toBe('a');
    expect(second).toEqual(first);
    expect(first.ranking.map((item) => item.candidateId)).toEqual(['a', 'b']);
  });

  it('fails closed on equal donor ranking instead of merging alternatives', () => {
    const first = candidate('a', 'iamcook');
    const second = candidate('b', 'russianfood');
    const selection = selectCanonicalDonor([first, second]);
    expect(selection.state).toBe('CANONICAL_DONOR_UNRESOLVED');
    expect(selection.donor).toBeNull();
    expect(selection.reason).toBe('EQUAL_DETERMINISTIC_DONOR_RANKING');
  });

  it.each([
    ['NaN sourceQuality input', { parseConfidence: Number.NaN }],
    ['NaN weightAppFit input', { servings: Number.NaN }],
    ['positive Infinity', { cookingTime: Number.POSITIVE_INFINITY }],
    ['negative Infinity', { preparationTime: Number.NEGATIVE_INFINITY }],
  ])('fails closed for %s', (_label, overrides) => {
    const selection = selectCanonicalDonor([candidate('invalid', 'bad', overrides), candidate('valid', 'good')]);
    expect(selection.state).toBe('CANONICAL_DONOR_UNRESOLVED');
    expect(selection.reason).toBe('INVALID_DONOR_SCORE');
    expect(selection.donor).toBeNull();
    expect(selection.ranking.find((item) => item.candidateId === 'invalid')?.eligible).toBe(false);
  });

  it('rejects an incomplete high-scoring donor and accepts a complete smaller donor', () => {
    const truncated = candidate('truncated', 'iamcook', { ingredients: [{ productId: 'curd', name: 'Творог', role: 'base', quantity: 400, unit: 'g', sourceIngredientOrdinal: 1, sourceClassification: 'LIKELY_FOOD' }] });
    const complete = candidate('complete', 'russianfood', { parseConfidence: 0.8 });
    const selection = selectCanonicalDonor([truncated, complete]);
    expect(selection.state).toBe('CANONICAL_DONOR_SELECTED');
    expect(selection.donor?.candidateId).toBe('complete');
    expect(selection.ranking.find((item) => item.candidateId === 'truncated')?.invalidFields).toContain('INCOMPLETE_CANONICAL_DONOR');
  });

  it('allows optional and process-input exclusions while retaining source ordinals', () => {
    const complete = candidate('complete', 'eda', { ingredients: [
      { productId: 'curd', name: 'Творог', role: 'base', quantity: 400, unit: 'g', sourceIngredientOrdinal: 1, sourceClassification: 'LIKELY_FOOD' },
      { productId: null, name: 'Соль', role: 'OPTIONAL', quantity: null, unit: null, sourceIngredientOrdinal: 2, sourceClassification: 'PROCESS_INPUT' },
    ] });
    const selection = selectCanonicalDonor([complete]);
    expect(selection.state).toBe('CANONICAL_DONOR_SELECTED');
    expect(selection.donor?.ingredients.map((item) => item.sourceIngredientOrdinal)).toEqual([1, 2]);
  });

  it.each([
    ['duplicate', [1, 1, 3]], ['out-of-range', [1, 2, 4]], ['zero', [0, 2, 3]],
    ['negative', [-1, 2, 3]], ['non-integer', [1, 1.5, 3]], ['NaN', [1, Number.NaN, 3]],
    ['Infinity', [1, Number.POSITIVE_INFINITY, 3]], ['missing', [1, 3, 4]],
  ])('rejects invalid source ordinal structure: %s', (_label, ordinals) => {
    const invalid = candidate('invalid-ordinal', 'eda', { sourceIngredientCount: 3, ingredients: ordinals.map((sourceIngredientOrdinal, index) => ({ productId: `p${index}`, name: `Ингредиент ${index}`, role: 'base', quantity: 1, unit: 'g', sourceIngredientOrdinal, sourceClassification: 'LIKELY_FOOD' })) });
    const selection = selectCanonicalDonor([invalid]);
    expect(selection.state).toBe('CANONICAL_DONOR_UNRESOLVED');
    expect(selection.donor).toBeNull();
    expect(selection.reason).toBe('INCOMPLETE_CANONICAL_DONOR');
  });

  it('accepts complete sequential ordinals and rejects missing required source line', () => {
    const complete = selectCanonicalDonor([candidate('complete-ordinal', 'eda')]);
    expect(complete.state).toBe('CANONICAL_DONOR_SELECTED');
    const missingRequired = selectCanonicalDonor([candidate('missing-required', 'eda', { sourceIngredientCount: 3, ingredients: [
      { productId: 'curd', name: 'Творог', sourceIngredientOrdinal: 1, quantity: 1, unit: 'g' },
      { productId: 'egg', name: 'Яйцо', sourceIngredientOrdinal: 3, quantity: 1, unit: 'pcs' },
    ] })]);
    expect(missingRequired.state).toBe('CANONICAL_DONOR_UNRESOLVED');
    expect(missingRequired.donor).toBeNull();
  });

  it('fails closed for empty and unresolved candidate sets and accepts one complete candidate', () => {
    expect(selectCanonicalDonor([]).donor).toBeNull();
    expect(selectCanonicalDonor([]).ranking).toEqual([]);
    expect(selectCanonicalDonor([candidate('one-complete', 'eda')]).state).toBe('CANONICAL_DONOR_SELECTED');
    const equal = selectCanonicalDonor([candidate('a', 'eda'), candidate('b', 'eda')]);
    expect(equal.state).toBe('CANONICAL_DONOR_UNRESOLVED');
    expect(equal.donor).toBeNull();
  });
});
