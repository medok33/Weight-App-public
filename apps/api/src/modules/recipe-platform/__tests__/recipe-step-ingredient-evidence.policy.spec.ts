import { describe, expect, it } from 'vitest';
import { buildDishConceptCluster } from '../domain/recipe-knowledge-synthesis.policy';
import { buildIngredientStepEvidence } from '../domain/recipe-step-ingredient-evidence.policy';
import type { ResearchCandidate } from '../domain/recipe-knowledge-synthesis.policy';

const candidate = (overrides: Partial<ResearchCandidate> = {}): ResearchCandidate => ({
  candidateId: '1000menu:julienne', sourceCode: '1000menu', sourceLineage: '1000menu', title: 'Жульен с курицей и грибами в духовке', conceptKey: 'julienne', rightsStatus: 'APPROVED',
  ingredients: [
    { productId: 'chicken_breast_raw', name: 'Куриное филе', role: 'REQUIRED' },
    { productId: 'mushroom_champignon_raw', name: 'Шампиньоны', role: 'REQUIRED' },
    { productId: 'family:сметана', name: 'Сметана', role: 'REQUIRED' },
    { productId: 'hard_cheese_45pct', name: 'Твёрдый сыр', role: 'REQUIRED' },
    { productId: 'olive_oil', name: 'Оливковое масло', role: 'REQUIRED' },
    { productId: 'step092_rice', name: 'Рис', role: 'REQUIRED' },
    { productId: 'mayonnaise', name: 'Майонез', role: 'REQUIRED' },
  ],
  steps: [
    { ordinal: 1, normalizedTechnique: 'FRY', sourceText: 'Разогрейте оливковое масло и обжарьте курицу с шампиньонами.' },
    { ordinal: 2, normalizedTechnique: 'PREPARE', sourceText: 'Влейте сметану и перемешайте.' },
    { ordinal: 3, normalizedTechnique: 'GRATE', sourceText: 'Сыр натрите.' },
    { ordinal: 4, normalizedTechnique: 'BAKE', temperatureC: 180, durationMinutes: 5, sourceText: 'Запекайте при 180 градусах 5 минут.' },
  ],
  provenance: { sourceUrl: 'https://1000.menu/cooking/julienne', rawSnapshotHash: 'a'.repeat(64), parserVersion: 'fixture', normalizedAt: '2026-08-20T00:00:00.000Z' },
  ...overrides,
});

describe('recipe step ingredient evidence', () => {
  it('links all five core products only from explicit step text', () => {
    const c = candidate();
    const cluster = buildDishConceptCluster([c, { ...c, candidateId: 'russianfood:julienne', sourceCode: 'russianfood' }], '2026-08-20T00:00:00.000Z');
    const result = buildIngredientStepEvidence({ cluster, candidates: [c, { ...c, candidateId: 'russianfood:julienne', sourceCode: 'russianfood' }] });
    expect(new Set(result.links.map((link) => link.canonicalProductId))).toEqual(new Set(['chicken_breast_raw', 'mushroom_champignon_raw', 'sour_cream_15pct', 'hard_cheese_45pct', 'olive_oil']));
    expect(result.links.every((link) => link.evidenceClass === 'EXPLICIT_STEP_TEXT_MATCH')).toBe(true);
    expect(result.sourceProseIncluded).toBe(false);
  });

  it('excludes rice and mayonnaise branches fail-closed', () => {
    const rice = candidate({ candidateId: 'russianfood:165685', sourceCode: 'russianfood', title: 'Рис с курицей, грибами и сыром (в духовке)' });
    const cluster = buildDishConceptCluster([candidate(), rice], '2026-08-20T00:00:00.000Z');
    const result = buildIngredientStepEvidence({ cluster, candidates: [candidate(), rice] });
    expect(result.links.some((link) => link.candidateId === rice.candidateId)).toBe(false);
    expect(result.excludedProductIds).toEqual(expect.arrayContaining(['step092_rice', 'mayonnaise']));
  });

  it('does not invent links without structured refs or explicit text', () => {
    const empty = candidate({ steps: [{ ordinal: 1, normalizedTechnique: 'FRY' }] });
    const cluster = buildDishConceptCluster([empty, { ...empty, candidateId: 'other:julienne', sourceCode: 'other' }], '2026-08-20T00:00:00.000Z');
    const result = buildIngredientStepEvidence({ cluster, candidates: [empty] });
    expect(result.links).toHaveLength(0);
    expect(result.unsupported.length).toBe(5);
  });

  it('accepts only supported structured reference confidence', () => {
    const structured = candidate({ steps: [{ ordinal: 1, normalizedTechnique: 'FRY', ingredientRefs: [{ ingredientIndex: 0, confidence: 'EXACT' }, { ingredientIndex: 1, confidence: 'IMPLICIT' }] }] });
    const cluster = buildDishConceptCluster([structured, { ...structured, candidateId: 'other:julienne', sourceCode: 'other' }], '2026-08-20T00:00:00.000Z');
    const result = buildIngredientStepEvidence({ cluster, candidates: [structured] });
    expect(result.links.map((link) => link.canonicalProductId)).toContain('chicken_breast_raw');
    expect(result.links.map((link) => link.canonicalProductId)).not.toContain('mushroom_champignon_raw');
  });
});

