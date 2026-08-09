import { describe, expect, it } from 'vitest';
import {
  canonicalizeAllergenToken,
  canonicalizeDietaryToken,
  resolveDishAllergens,
  resolveDishDietaryTags,
  userAllergenLabels,
} from '../domain/dish-restrictions.policy';

describe('dish restrictions policy (RP2-02A acceptance)', () => {
  it('canonicalizes allergen aliases and dedupes peanut/peanuts', () => {
    const resolved = resolveDishAllergens({
      recipeTokens: ['peanut', 'peanuts', 'dairy', 'milk'],
    });
    expect(resolved.internalCodes).toEqual(['MILK', 'PEANUT']);
    expect(userAllergenLabels(resolved.user)).toEqual(['Молоко', 'Арахис']);
  });

  it('does not map lactose intolerance to MILK allergen', () => {
    expect(canonicalizeAllergenToken('lactose')).toBeNull();
    const resolved = resolveDishAllergens({ recipeTokens: ['lactose'] });
    expect(resolved.internalCodes).toEqual([]);
  });

  it('normalizes dietary aliases to one canonical code', () => {
    expect(canonicalizeDietaryToken('gluten-free')).toBe('GLUTEN_FREE');
    expect(canonicalizeDietaryToken('gluten_free')).toBe('GLUTEN_FREE');
    expect(canonicalizeDietaryToken('GLUTEN_FREE')).toBe('GLUTEN_FREE');
  });

  it('blocks vegan/vegetarian when chicken is present', () => {
    const resolved = resolveDishDietaryTags({
      claimedTags: ['vegan', 'vegetarian', 'high-protein'],
      ingredientNames: ['Курица', 'Гречка'],
    });
    expect(resolved.internalAccepted).toEqual(['HIGH_PROTEIN']);
    expect(resolved.warnings.some((w) => w.code.includes('VEGAN'))).toBe(true);
    expect(resolved.warnings.some((w) => w.code.includes('VEGETARIAN'))).toBe(true);
    expect(resolved.user.map((t) => t.label)).toEqual(['Высокобелковое']);
  });

  it('blocks gluten-free when gluten allergen is present', () => {
    const resolved = resolveDishDietaryTags({
      claimedTags: ['GLUTEN_FREE'],
      allergenCodes: ['GLUTEN'],
      ingredientNames: ['Паста'],
    });
    expect(resolved.internalAccepted).toEqual([]);
    expect(resolved.warnings[0]?.code).toBe('DIETARY_CONFLICT_GLUTEN_FREE');
  });

  it('unknown composition never yields positive dietary claims', () => {
    const resolved = resolveDishDietaryTags({
      claimedTags: ['vegan'],
      unknownComposition: true,
    });
    expect(resolved.user).toEqual([]);
  });
});
