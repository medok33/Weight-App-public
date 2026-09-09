import { describe, expect, it } from 'vitest';
import { resolveCanonicalDonorServings } from '../domain/recipe-knowledge-synthesis.policy';

describe('canonical donor servings boundary', () => {
  const donor = { candidateId: 'eda:rice', sourceCode: 'eda', title: 'Rice', rightsStatus: 'APPROVED' as const, ingredients: [], servings: 6, servingsRaw: '6' };
  it('uses donor-local servings and preserves provenance', () => {
    const resolved = resolveCanonicalDonorServings(donor, 'cluster-rice');
    expect(resolved.servings).toBe(6);
    expect(resolved.provenance.canonicalDonorCandidateId).toBe('eda:rice');
    expect(resolved.provenance.sourceField).toBe('recipeFacts.portions');
    expect(resolved.provenance.rawServings).toBe('6');
  });
  it('fails closed for missing and invalid servings without fallback', () => {
    for (const value of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveCanonicalDonorServings({ ...donor, servings: value }, 'cluster-rice').state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
    }
  });
});
