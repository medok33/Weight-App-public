/**
 * CATALOG-V3-01B — unit validation of classification SoT.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG_V3_01B_CLASSIFICATION,
  CATALOG_V3_01B_CLASSIFICATION_VERSION,
} from '../catalog-v3-01b-classification';
import { validateV301bClassificationManifest } from '../catalog-v3-01b-classification.validation';
import { WORKOUT_CATALOG_MANIFEST } from '../catalog-manifest';

describe('CATALOG-V3-01B classification SoT', () => {
  it('accounts for exactly 84 keys with expected dispositions', () => {
    const report = validateV301bClassificationManifest();
    expect(report.ok, JSON.stringify(report.issues.slice(0, 10))).toBe(true);
    expect(report.entryCount).toBe(84);
    expect(report.version).toBe(CATALOG_V3_01B_CLASSIFICATION_VERSION);
    expect(report.dispositionCounts).toEqual({
      KEEP: 6,
      KEEP_RENAME: 0,
      KEEP_RECLASSIFY: 69,
      MERGE_VARIANT: 3,
      KEEP_NOT_DEFAULT: 6,
      DEPRECATE: 0,
    });
  });

  it('covers every catalog manifest key exactly once', () => {
    const classified = new Set(CATALOG_V3_01B_CLASSIFICATION.map((e) => e.exerciseKey));
    const manifest = new Set(
      WORKOUT_CATALOG_MANIFEST.map((e) => e.legacyExerciseKey ?? e.slug),
    );
    expect(classified.size).toBe(84);
    expect(manifest.size).toBe(84);
    for (const key of manifest) {
      expect(classified.has(key), key).toBe(true);
    }
  });

  it('keeps MERGE_VARIANT walks as plan-only identities', () => {
    const merges = CATALOG_V3_01B_CLASSIFICATION.filter(
      (e) => e.disposition === 'MERGE_VARIANT',
    );
    expect(merges.map((e) => e.exerciseKey).sort()).toEqual([
      'brisk_outdoor_walk',
      'morning_walk',
      'recovery_walk',
    ]);
    for (const e of merges) {
      expect(e.identityAction).toBe('PLAN_ONLY_NO_PHYSICAL_MERGE');
    }
  });

  it('does not invent fake readiness on classification rows', () => {
    for (const e of CATALOG_V3_01B_CLASSIFICATION) {
      expect(e).not.toHaveProperty('readiness');
      expect(e).not.toHaveProperty('generatorReady');
    }
  });

  it('rejects empty equipment groups at SoT validation layer', () => {
    const sample = {
      ...CATALOG_V3_01B_CLASSIFICATION[0]!,
      exerciseKey: CATALOG_V3_01B_CLASSIFICATION[0]!.exerciseKey,
      equipmentGroups: [{ groupKind: 'ALL_OF', sortOrder: 0, items: [] }],
    };
    const report = validateV301bClassificationManifest([
      sample,
      ...CATALOG_V3_01B_CLASSIFICATION.slice(1),
    ]);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'EMPTY_EQUIPMENT_GROUP')).toBe(true);
  });
});
