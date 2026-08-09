import { describe, expect, it } from 'vitest';
import {
  assertLifecycleTransition,
  buildRevalidationDedupeKey,
  isUsableForNewPlans,
  mapImpactPolicy,
  NON_IMPACTING_PRODUCT_EVENTS,
} from '../domain/recipe-lifecycle.policy';

describe('recipe lifecycle policy (STEP_205)', () => {
  it('allows IN_REVIEW → APPROVED → PUBLISHED', () => {
    expect(() => assertLifecycleTransition('IN_REVIEW', 'APPROVED')).not.toThrow();
    expect(() => assertLifecycleTransition('APPROVED', 'PUBLISHED')).not.toThrow();
  });

  it('rejects invalid transitions', () => {
    expect(() => assertLifecycleTransition('REJECTED', 'PUBLISHED')).toThrow(
      /RECIPE_LIFECYCLE_TRANSITION_INVALID/,
    );
    expect(() => assertLifecycleTransition('ARCHIVED', 'PUBLISHED')).toThrow(
      /RECIPE_LIFECYCLE_TRANSITION_INVALID/,
    );
  });

  it('usable resolver requires PUBLISHED + VALID + current pointer match', () => {
    expect(
      isUsableForNewPlans({
        lifecycleStatus: 'PUBLISHED',
        validationStatus: 'VALID',
        currentVersionId: 'a',
        recipeVersionId: 'a',
      }),
    ).toBe(true);
    expect(
      isUsableForNewPlans({
        lifecycleStatus: 'PUBLISHED',
        validationStatus: 'NEEDS_REVALIDATION',
        currentVersionId: 'a',
        recipeVersionId: 'a',
      }),
    ).toBe(false);
    expect(
      isUsableForNewPlans({
        lifecycleStatus: 'SUPERSEDED',
        validationStatus: 'VALID',
        currentVersionId: 'a',
        recipeVersionId: 'a',
      }),
    ).toBe(false);
    expect(
      isUsableForNewPlans({
        lifecycleStatus: 'PUBLISHED',
        validationStatus: 'VALID',
        currentVersionId: 'a',
        recipeVersionId: 'b',
      }),
    ).toBe(false);
  });
});

describe('recipe revalidation policy (STEP_206)', () => {
  it('maps nutrition change to WARNING + NEEDS_REVALIDATION', () => {
    expect(mapImpactPolicy('PRODUCT_NUTRITION_VERSION_CHANGED')).toEqual({
      severity: 'WARNING',
      validationStatus: 'NEEDS_REVALIDATION',
      allowConfirmCurrent: true,
    });
  });

  it('maps merge/suspend to CRITICAL + BLOCKED', () => {
    expect(mapImpactPolicy('PRODUCT_MERGED').severity).toBe('CRITICAL');
    expect(mapImpactPolicy('PRODUCT_SUSPENDED').validationStatus).toBe('BLOCKED');
    expect(mapImpactPolicy('PRODUCT_MERGED').allowConfirmCurrent).toBe(false);
  });

  it('builds stable dedupe keys', () => {
    expect(
      buildRevalidationDedupeKey({
        recipeVersionId: 'v1',
        productId: 'p1',
        reasonCode: 'PRODUCT_ALLERGEN_CHANGED',
      }),
    ).toBe('v1:p1:PRODUCT_ALLERGEN_CHANGED');
  });

  it('documents non-impacting product events', () => {
    expect(NON_IMPACTING_PRODUCT_EVENTS).toContain('PRICE_OBSERVATION');
    expect(NON_IMPACTING_PRODUCT_EVENTS).toContain('PRODUCT_ALIAS_CORRECTION');
  });
});
