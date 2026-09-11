import { describe, expect, it } from 'vitest';
import { buildAuthorityGapLedger, evaluateBriefGrammageReadiness } from '../domain/recipe-grammage-readiness.policy';

const base = { clusterId: 'cluster', canonicalDonorCandidateId: 'eda:donor' };
const line = (overrides: Record<string, unknown> = {}) => ({ sourceLabel: 'ingredient', productId: 'product', quantity: 100, unit: 'g', role: 'REQUIRED', optional: false, sourceCandidateId: 'eda:donor', sourceIngredientOrdinal: 1, ...overrides });

describe('grammage readiness gate', () => {
  it('is ready only when every required canonical-donor line resolves', () => {
    expect(evaluateBriefGrammageReadiness({ ...base, selections: [line()] }).readiness).toBe('READY_FOR_SYNTHESIS');
    expect(evaluateBriefGrammageReadiness({ ...base, selections: [line(), line({ quantity: 2, unit: 'tbsp' })] }).readiness).toBe('NOT_READY_FOR_SYNTHESIS');
  });
  it('classifies authority gaps without guessed values', () => {
    const result = evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: 2, unit: 'tbsp' }), line({ quantity: 1, unit: 'piece' })] });
    expect(result.lines.map((item) => item.blockerClass)).toEqual(['DENSITY_AUTHORITY', 'PIECE_WEIGHT_AUTHORITY']);
    expect(result.lines.every((item) => item.resolution.grams === null)).toBe(true);
  });
  it('blocks malformed quantity and unsupported units', () => {
    const result = evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: null }), line({ unit: 'bushel' })] });
    expect(result.readiness).toBe('NOT_READY_FOR_SYNTHESIS');
    expect(result.lines.map((item) => item.blockerClass)).toEqual(['MISSING_OR_MALFORMED_QUANTITY', 'UNSUPPORTED_UNIT']);
  });
  it('does not let optional, representative, or another donor close a gap', () => {
    const result = evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: 2, unit: 'piece', optional: true }), line({ quantity: 2, unit: 'piece', sourceCandidateId: 'other:donor' })] });
    expect(result.unresolvedRequiredLines).toBe(2);
    expect(result.lines[0]?.canonicalDonorCandidateId).toBe('eda:donor');
  });
  it('is order independent and ledger remains line-complete across duplicate gaps', () => {
    const a = evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: 2, unit: 'tbsp', sourceIngredientOrdinal: 1 }), line({ quantity: 3, unit: 'tbsp', sourceIngredientOrdinal: 2 })] });
    const b = evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: 3, unit: 'tbsp', sourceIngredientOrdinal: 2 }), line({ quantity: 2, unit: 'tbsp', sourceIngredientOrdinal: 1 })] });
    expect(a.lines.map((x) => x.blockerClass).sort()).toEqual(b.lines.map((x) => x.blockerClass).sort());
    expect(buildAuthorityGapLedger([a])).toHaveLength(2);
  });
  it('does not manufacture a cooked yield or serving weight', () => {
    const result = evaluateBriefGrammageReadiness({ ...base, selections: [line()] });
    expect(result).not.toHaveProperty('servingWeightGrams');
    expect(result).not.toHaveProperty('cookedYieldGrams');
  });
  it('fails closed for donor identity and caller-controlled optional markers', () => {
    const missing = evaluateBriefGrammageReadiness({ ...base, selections: [line({ sourceCandidateId: undefined, optional: true })] });
    const foreign = evaluateBriefGrammageReadiness({ ...base, selections: [line({ sourceCandidateId: 'representative:other', required: false })] });
    expect(missing.readiness).toBe('NOT_READY_FOR_SYNTHESIS');
    expect(foreign.readiness).toBe('NOT_READY_FOR_SYNTHESIS');
    expect(missing.unresolvedRequiredLines).toBe(1);
    expect(foreign.unresolvedRequiredLines).toBe(1);
  });
  it('never throws for malformed runtime amount or unit values', () => {
    for (const value of [null, undefined, {}, [], true, 'NaN', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: value, unit: value })] })).not.toThrow();
      expect(evaluateBriefGrammageReadiness({ ...base, selections: [line({ quantity: value, unit: value })] }).readiness).toBe('NOT_READY_FOR_SYNTHESIS');
    }
  });
  it('groups equivalent units while preserving line count', () => {
    const result = evaluateBriefGrammageReadiness({ ...base, selections: [line({ unit: 'tbsp' }), line({ unit: 'STOL_L', sourceIngredientOrdinal: 2 })] });
    const ledger = buildAuthorityGapLedger([result]);
    expect(new Set(ledger.map((row) => row.gapKey)).size).toBe(1);
    expect(ledger).toHaveLength(2);
  });
});
