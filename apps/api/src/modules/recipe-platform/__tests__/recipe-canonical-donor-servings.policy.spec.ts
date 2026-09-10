import { describe, expect, it } from 'vitest';
import { resolveCanonicalDonorServings } from '../domain/recipe-knowledge-synthesis.policy';

describe('canonical donor servings boundary', () => {
  const donor = { candidateId: 'eda:rice', sourceCode: 'eda', title: 'Rice', rightsStatus: 'APPROVED' as const, ingredients: [], servings: 6, servingsRaw: '6' };
  it('uses donor-local raw servings and preserves provenance', () => {
    const resolved = resolveCanonicalDonorServings(donor, 'cluster-rice');
    expect(resolved.servings).toBe(6);
    expect(resolved.provenance.canonicalDonorCandidateId).toBe('eda:rice');
    expect(resolved.provenance.sourceField).toBe('recipeFacts.portions');
    expect(resolved.provenance.rawServings).toBe('6');
  });
  it('requires genuine raw source and fails closed for invalid values', () => {
    for (const value of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '6', {}, [], true]) {
      expect(resolveCanonicalDonorServings({ ...donor, servings: value as never, servingsRaw: '6' }, 'cluster-rice').state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
    }
    for (const raw of [null, undefined, '', ' ', 'six', '6x', 'NaN', 'Infinity']) {
      expect(resolveCanonicalDonorServings({ ...donor, servingsRaw: raw as never }, 'cluster-rice').state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
    }
    expect(resolveCanonicalDonorServings({ ...donor, servingsRaw: undefined }, 'cluster-rice').state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
  });

  it('rejects raw/normalized mismatch and never fabricates raw provenance', () => {
    const mismatch = resolveCanonicalDonorServings({ ...donor, servings: 3, servingsRaw: '6' }, 'cluster-rice');
    expect(mismatch.state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
    expect(mismatch.provenance.rawServings).toBe('6');
    expect(mismatch.provenance.normalizedServings).toBeNull();

    const missingRaw = resolveCanonicalDonorServings({ ...donor, servingsRaw: null }, 'cluster-rice');
    expect(missingRaw.state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
    expect(missingRaw.provenance.rawServings).toBeNull();
    expect(missingRaw.provenance.normalizedServings).toBeNull();
  });

  it('does not borrow raw servings from representative or another donor', () => {
    const unresolved = resolveCanonicalDonorServings({ ...donor, candidateId: 'canonical', servingsRaw: null }, 'cluster-rice');
    expect(unresolved.state).toBe('CANONICAL_DONOR_SERVINGS_UNRESOLVED');
  });
});
