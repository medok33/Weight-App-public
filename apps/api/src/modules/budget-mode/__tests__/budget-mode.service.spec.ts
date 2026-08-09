import { describe, expect, it } from 'vitest';
import { optimizeCandidates, validatePreferences } from '../domain/budget-mode.policy';

describe('budget mode policy', () => {
  it('filters excluded tags before soft cost ranking', () => {
    const result = optimizeCandidates([
      { id: 'dairy', name: 'greek_yogurt', calories: 200, tags: ['dairy'] },
      { id: 'safe', name: 'vegetable_soup', calories: 250, tags: [] },
    ], ['dairy'], { mode: 'frugal' });
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['safe']);
    expect(result.priceConfidence).toBe('approximate');
  });
  it('validates known modes only', () => {
    expect(() => validatePreferences({ mode: 'unsafe' })).toThrow('BUDGET_MODE_INVALID');
  });
});
