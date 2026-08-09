import { describe, expect, it } from 'vitest';
import { explainPantryUsage, selectPantryFirstCandidates } from '../domain/pantry.policy';

const candidates = [
  { id: 'safe', name: 'oatmeal_bowl', calories: 300, tags: [] },
  { id: 'allergen', name: 'greek_yogurt', calories: 200, tags: ['dairy'] },
];
const ingredient = (name: string) => name === 'oatmeal_bowl' ? [{ name: 'oats' }, { name: 'milk' }] : [{ name: 'greek_yogurt' }];
const item = (name: string, expiresOn: string | null) => ({ id: name, userId: 'u', pantryId: 'p', name, quantity: 1, unit: 'pcs' as const, expiresOn, createdAt: '', updatedAt: '' });

describe('pantry-first candidate policy', () => {
  it('never treats expired items as pantry stock', () => {
    expect(explainPantryUsage(['oatmeal_bowl'], [item('oats', '2026-01-01')], '2026-01-02', ingredient).usedFromPantry).toEqual([]);
  });
  it('keeps excluded allergen candidates filtered', () => {
    expect(selectPantryFirstCandidates(candidates, ['dairy'], [item('greek_yogurt', null)], '2026-01-02', ingredient).map((candidate) => candidate.id)).toEqual(['safe']);
  });
  it('is pure and cannot mutate an immutable published plan', () => {
    const original = structuredClone(candidates);
    selectPantryFirstCandidates(candidates, [], [item('oats', null)], '2026-01-02', ingredient);
    expect(candidates).toEqual(original);
  });
});
