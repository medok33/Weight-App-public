import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPE_CATALOG_DATA_CLASSES,
  isNonProductionRecipeDataClass,
  parseRecipeDataClassFilter,
  resolveRecipeDataClass,
} from '../domain/recipe-data-class.policy';
import {
  listAllowedLifecycleActions,
  lifecycleStatusLabelRu,
  versionPublicationDisplay,
} from '../domain/recipe-lifecycle-actions.policy';
import { searchRecommendationLabelRu } from '../domain/recipe-admin-labels.policy';
import { diffRecipeVersions } from '../domain/recipe-version-diff.policy';

describe('recipe-data-class.policy', () => {
  it('resolves from persisted dataClass first', () => {
    expect(resolveRecipeDataClass({ dataClass: 'FIXTURE', recipeKey: 'cust_x' })).toBe('FIXTURE');
  });

  it('derives TEST/HISTORICAL from recipeKey not display name', () => {
    expect(resolveRecipeDataClass({ recipeKey: 'cust_dish_1', dataClass: null })).toBe('TEST_ONLY');
    expect(resolveRecipeDataClass({ recipeKey: 'hist_dish_1', dataClass: null })).toBe('HISTORICAL_ONLY');
    expect(resolveRecipeDataClass({ recipeKey: 'buckwheat_chicken', dataClass: null })).toBe('PRODUCTION');
  });

  it('overrides mistaken PRODUCTION when recipeKey is clearly test-shaped', () => {
    expect(resolveRecipeDataClass({ recipeKey: 'cust_dish_1', dataClass: 'PRODUCTION' })).toBe('TEST_ONLY');
    expect(resolveRecipeDataClass({ recipeKey: 'rp202c_r1_1', dataClass: 'PRODUCTION' })).toBe('TEST_ONLY');
    expect(resolveRecipeDataClass({ recipeKey: 'rp2_test_1', dataClass: 'PRODUCTION' })).toBe('TEST_ONLY');
  });

  it('defaults catalog filter to PRODUCTION only', () => {
    expect(parseRecipeDataClassFilter(undefined)).toEqual([...DEFAULT_RECIPE_CATALOG_DATA_CLASSES]);
    expect(parseRecipeDataClassFilter('ALL')).toBeNull();
    expect(isNonProductionRecipeDataClass('TEST_ONLY')).toBe(true);
  });
});

describe('recipe-lifecycle-actions.policy', () => {
  it('returns only allowed actions per status', () => {
    expect(listAllowedLifecycleActions({ lifecycleStatus: 'IN_REVIEW' })).toEqual(['APPROVE', 'REJECT']);
    expect(listAllowedLifecycleActions({ lifecycleStatus: 'APPROVED', validationStatus: 'VALID' })).toEqual([
      'PUBLISH',
      'REJECT',
    ]);
    expect(listAllowedLifecycleActions({ lifecycleStatus: 'PUBLISHED' })).toEqual(['SUSPEND', 'ARCHIVE']);
    expect(
      listAllowedLifecycleActions({
        lifecycleStatus: 'SUPERSEDED',
        validationStatus: 'VALID',
        role: 'OWNER',
      }),
    ).toEqual(['RESTORE', 'ARCHIVE']);
    expect(
      listAllowedLifecycleActions({
        lifecycleStatus: 'SUPERSEDED',
        validationStatus: 'VALID',
        role: 'ADMIN',
      }),
    ).toEqual(['ARCHIVE']);
  });

  it('maps RU lifecycle labels and avoids IN_REVIEW published contradiction', () => {
    expect(lifecycleStatusLabelRu('IN_REVIEW')).toBe('На проверке');
    const pub = versionPublicationDisplay({
      lifecycleStatus: 'IN_REVIEW',
      publishedAt: new Date(),
    });
    expect(pub.isPublishedSemantics).toBe(false);
    expect(pub.publicationLabelRu).toBeNull();
    expect(versionPublicationDisplay({ lifecycleStatus: 'PUBLISHED', publishedAt: new Date() }).isPublishedSemantics).toBe(
      true,
    );
  });
});

describe('recipe-admin-labels + version diff', () => {
  it('localizes search recommendations', () => {
    expect(searchRecommendationLabelRu('USE_EXISTING_RECIPE')).toContain('существующий');
    expect(searchRecommendationLabelRu('RESEARCH_REQUIRED')).toContain('исследование');
  });

  it('diffs ingredients without raw JSON string compare', () => {
    const diff = diffRecipeVersions({
      before: {
        servings: 1,
        contentSnapshotJson: { title: 'A' },
        ingredientsSnapshotJson: [{ productId: 'p1', productName: 'Рис', quantity: 100, unit: 'g' }],
        stepsSnapshotJson: [{ order: 1, text: 'Варить' }],
        nutritionSnapshotJson: { calories: 100 },
        restrictionSnapshotJson: { allergens: [] },
      },
      after: {
        servings: 2,
        contentSnapshotJson: { title: 'A' },
        ingredientsSnapshotJson: [{ productId: 'p1', productName: 'Рис', quantity: 150, unit: 'g' }],
        stepsSnapshotJson: [{ order: 1, text: 'Варить дольше' }],
        nutritionSnapshotJson: { calories: 150 },
        restrictionSnapshotJson: { allergens: [] },
      },
    });
    expect(diff.sections.find((s) => s.field === 'servings')?.changeKind).toBe('CHANGED');
    expect(diff.ingredientChanges.some((c) => c.kind === 'QUANTITY_CHANGED')).toBe(true);
    expect(diff.stepChanges.some((c) => c.kind === 'CHANGED')).toBe(true);
  });
});
