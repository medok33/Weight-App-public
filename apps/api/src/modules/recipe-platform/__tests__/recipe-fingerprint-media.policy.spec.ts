import { describe, expect, it } from 'vitest';
import {
  buildFingerprintHashes,
  classifySimilarity,
  normalizeRecipeTitle,
  orderedPairKey,
  RECIPE_FINGERPRINT_SCHEMA_V1,
  type FingerprintFeatures,
} from '../domain/recipe-fingerprint.policy';
import {
  isPublicationEligibleMedia,
  requiresAttribution,
  toUserMediaDto,
} from '../domain/recipe-media.policy';

function baseFeatures(overrides: Partial<FingerprintFeatures> = {}): FingerprintFeatures {
  return {
    schemaVersion: RECIPE_FINGERPRINT_SCHEMA_V1,
    titleNormalized: 'kurica s grechkoi',
    servingsOriginal: 2,
    normalizationBasis: 'PER_SERVING',
    ingredients: [
      {
        canonicalProductId: 'p1',
        form: 'RAW',
        culinaryRole: null,
        amountPerServing: 100,
        unit: 'g',
        conversionStatus: 'NORMALIZED',
        position: 0,
      },
      {
        canonicalProductId: 'p2',
        form: 'DRY',
        culinaryRole: null,
        amountPerServing: 50,
        unit: 'g',
        conversionStatus: 'NORMALIZED',
        position: 1,
      },
    ],
    cooking: {
      stepCount: 3,
      durationMinutes: [10, 20],
      temperaturesC: [],
      equipment: ['pan'],
      structureConfidence: 'MEDIUM',
    },
    familyId: 'fam1',
    dishType: 'MAIN',
    primaryProductId: 'p1',
    ...overrides,
  };
}

describe('recipe fingerprint policy (STEP_207)', () => {
  it('normalizes title punctuation and yo', () => {
    expect(normalizeRecipeTitle('  Курица, с  гречкой! ')).toBe('курица с гречкой');
    expect(normalizeRecipeTitle('Ёлка')).toBe('елка');
  });

  it('is deterministic for same features', () => {
    const a = buildFingerprintHashes(baseFeatures());
    const b = buildFingerprintHashes(baseFeatures());
    expect(a.exactContentHash).toBe(b.exactContentHash);
    expect(a.checksum).toBe(b.checksum);
  });

  it('serving scale keeps quantity hash when per-serving equal', () => {
    const two = buildFingerprintHashes(baseFeatures({ servingsOriginal: 2 }));
    const four = buildFingerprintHashes(baseFeatures({ servingsOriginal: 4 }));
    expect(two.ingredientQuantityHash).toBe(four.ingredientQuantityHash);
  });

  it('ingredient change changes fingerprint', () => {
    const a = buildFingerprintHashes(baseFeatures());
    const b = buildFingerprintHashes(
      baseFeatures({
        ingredients: [
          {
            canonicalProductId: 'p9',
            form: 'RAW',
            culinaryRole: null,
            amountPerServing: 100,
            unit: 'g',
            conversionStatus: 'NORMALIZED',
            position: 0,
          },
        ],
      }),
    );
    expect(a.ingredientSetHash).not.toBe(b.ingredientSetHash);
  });

  it('classifies exact/near/variant/distinct', () => {
    expect(
      classifySimilarity({
        sameRecipe: false,
        score: 0.99,
        ingredientOverlap: 1,
        quantityDelta: 0.02,
        samePrimary: true,
        sameFamily: true,
        cookingMatch: 1,
        titleMatch: true,
      }).classification,
    ).toBe('EXACT_DUPLICATE');
    expect(
      classifySimilarity({
        sameRecipe: false,
        score: 0.88,
        ingredientOverlap: 0.9,
        quantityDelta: 0.1,
        samePrimary: true,
        sameFamily: false,
        cookingMatch: 1,
        titleMatch: false,
      }).classification,
    ).toBe('NEAR_DUPLICATE');
    expect(
      classifySimilarity({
        sameRecipe: true,
        score: 1,
        ingredientOverlap: 1,
        quantityDelta: 0,
        samePrimary: true,
        sameFamily: true,
        cookingMatch: 1,
        titleMatch: true,
      }).classification,
    ).toBe('DISTINCT');
  });

  it('orders candidate pairs canonically', () => {
    const a = orderedPairKey('b', 'a');
    expect(a.left).toBe('a');
    expect(a.right).toBe('b');
    expect(a.pairKey).toBe('a:b');
  });
});

describe('recipe media policy (STEP_208)', () => {
  it('blocks legacy unknown and pending rights', () => {
    expect(
      isPublicationEligibleMedia({
        rightsStatus: 'PENDING_REVIEW',
        moderationStatus: 'APPROVED',
        licenseType: 'ALL_RIGHTS_OWNED',
        sourceType: 'OWNED_UPLOAD',
      }).eligible,
    ).toBe(false);
    expect(
      isPublicationEligibleMedia({
        rightsStatus: 'APPROVED',
        moderationStatus: 'APPROVED',
        licenseType: 'ALL_RIGHTS_OWNED',
        sourceType: 'LEGACY_UNKNOWN',
      }).eligible,
    ).toBe(false);
  });

  it('requires attribution for CC_BY', () => {
    expect(requiresAttribution('CC_BY')).toBe(true);
    expect(
      isPublicationEligibleMedia({
        rightsStatus: 'APPROVED',
        moderationStatus: 'APPROVED',
        licenseType: 'CC_BY',
        sourceType: 'CREATIVE_COMMONS',
        attributionText: '',
      }).reason,
    ).toBe('MEDIA_ATTRIBUTION_REQUIRED');
  });

  it('redacts internal fields from USER DTO', () => {
    const dto = toUserMediaDto({
      id: 'link1',
      role: 'HERO',
      altText: 'Dish',
      caption: null,
      width: 100,
      height: 80,
      mimeType: 'image/jpeg',
      deliveryUrl: '/api/v1/media/x/content',
      placeholder: false,
    });
    expect(dto).not.toHaveProperty('storageKey');
    expect(dto).not.toHaveProperty('sourceUrl');
    expect(dto.url).toContain('/media/');
  });
});
