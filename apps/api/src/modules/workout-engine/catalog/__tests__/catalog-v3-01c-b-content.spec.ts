/**
 * CATALOG-V3-01C-B — unit validation of Batch B content + polish SoT.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG_V3_01C_A_CONTENT } from '../catalog-v3-01c-a-content';
import {
  CATALOG_V3_01C_B_CONTENT,
  CATALOG_V3_01C_B_DEPRECATIONS,
  CATALOG_V3_01C_B_EXPECTED_COUNT,
  CATALOG_V3_01C_B_HELD,
  CATALOG_V3_01C_B_POLISH,
  CATALOG_V3_01C_B_VERSION,
} from '../catalog-v3-01c-b-content';
import { validateV301cBContentManifest } from '../catalog-v3-01c-b-content.validation';
import { WORKOUT_CATALOG_MANIFEST } from '../catalog-manifest';
import { confirmV301cBApplyDatabase } from '../catalog-v3-01c-b-content-loader';

describe('CATALOG-V3-01C-B content SoT', () => {
  it('validates Batch B count with complete V3 metadata', () => {
    const report = validateV301cBContentManifest();
    expect(report.ok, JSON.stringify(report.issues.slice(0, 12))).toBe(true);
    expect(report.entryCount).toBe(CATALOG_V3_01C_B_EXPECTED_COUNT);
    expect(report.entryCount).toBe(33);
    expect(report.polishCount).toBe(3);
    expect(report.deprecationCount).toBe(1);
    expect(report.version).toBe(CATALOG_V3_01C_B_VERSION);
  });

  it('does not collide with existing 84 or Batch A keys', () => {
    const existing = new Set(
      WORKOUT_CATALOG_MANIFEST.map((e) => e.legacyExerciseKey ?? e.slug),
    );
    const batchA = new Set(CATALOG_V3_01C_A_CONTENT.map((e) => e.exerciseKey));
    for (const e of CATALOG_V3_01C_B_CONTENT) {
      expect(existing.has(e.exerciseKey), e.exerciseKey).toBe(false);
      expect(batchA.has(e.exerciseKey), e.exerciseKey).toBe(false);
    }
  });

  it('keeps held ADD candidates out of the authored set', () => {
    const authored = new Set(CATALOG_V3_01C_B_CONTENT.map((e) => e.exerciseKey));
    expect(CATALOG_V3_01C_B_HELD.length).toBeGreaterThanOrEqual(5);
    for (const h of CATALOG_V3_01C_B_HELD) {
      expect(authored.has(h.exerciseKey), h.exerciseKey).toBe(false);
      expect(
        h.reason.includes('BATCH_B_HELD_FOR_IDENTITY_REVIEW') ||
          h.reason.includes('BATCH_B_HELD_DUPLICATE_OF_PUBLISHED') ||
          h.reason.includes('MISSING_ACCEPTED_ANKLE_DORSIFLEXION_PATTERN'),
        h.exerciseKey,
      ).toBe(true);
    }
  });

  it('FIX-01: removes published duplicates and holds tibialis without ankle pattern', () => {
    const authored = new Set(CATALOG_V3_01C_B_CONTENT.map((e) => e.exerciseKey));
    for (const key of [
      'machine_chest_fly',
      'glute_bridge_march_hold',
      'ankle_mobility_knee_over_toe',
      'tibialis_raise',
    ]) {
      expect(authored.has(key), key).toBe(false);
    }
    expect(CATALOG_V3_01C_B_CONTENT.some((e) => e.primaryMovementPattern === 'KNEE_EXTENSION')).toBe(
      false,
    );
    const held = Object.fromEntries(
      CATALOG_V3_01C_B_HELD.map((h) => [h.exerciseKey, h.reason]),
    );
    expect(held.machine_chest_fly).toContain('pec_deck_machine');
    expect(held.glute_bridge_march_hold).toContain('glute_bridge_march');
    expect(held.ankle_mobility_knee_over_toe).toContain('ankle_rocks');
    expect(held.tibialis_raise).toContain('MISSING_ACCEPTED_ANKLE_DORSIFLEXION_PATTERN');
  });

  it('does not fabricate readiness / energy claims in SoT', () => {
    for (const e of CATALOG_V3_01C_B_CONTENT) {
      expect(e).not.toHaveProperty('readiness');
      expect(e).not.toHaveProperty('generatorReady');
      expect(e).not.toHaveProperty('energyReady');
      expect(e.techniqueRu.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('closes five Batch-A polish findings with explicit decisions', () => {
    expect(CATALOG_V3_01C_B_DEPRECATIONS.some((d) => d.exerciseKey === 'lat_pulldown_wide')).toBe(
      true,
    );
    expect(
      CATALOG_V3_01C_B_DEPRECATIONS.find((d) => d.exerciseKey === 'lat_pulldown_wide')?.mergeIntoKey,
    ).toBe('lat_pulldown');

    const bulgarian = CATALOG_V3_01C_B_POLISH.find((p) => p.exerciseKey === 'bulgarian_split_squat')!;
    const allOf = bulgarian.equipmentGroups.find((g) => g.groupKind === 'ALL_OF')!;
    expect(allOf.items.map((i) => i.equipmentCode).sort()).toEqual(['BENCH', 'BODYWEIGHT']);

    const chin = CATALOG_V3_01C_B_POLISH.find((p) => p.exerciseKey === 'chin_up')!;
    expect(chin.muscles.some((m) => m.muscleCode === 'UPPER_BACK' && m.involvement === 'SECONDARY')).toBe(
      true,
    );

    const fly = CATALOG_V3_01C_B_POLISH.find((p) => p.exerciseKey === 'dumbbell_fly')!;
    expect(
      fly.muscles.some((m) => m.muscleCode === 'FRONT_DELTS' && m.involvement === 'SECONDARY'),
    ).toBe(true);
  });

  it('uses non-MAIN roles for conditioning / mobility / recovery content', () => {
    const byRole = new Map<string, number>();
    for (const e of CATALOG_V3_01C_B_CONTENT) {
      byRole.set(e.trainingRole, (byRole.get(e.trainingRole) ?? 0) + 1);
    }
    expect(byRole.get('CONDITIONING') ?? 0).toBeGreaterThanOrEqual(5);
    expect((byRole.get('MOBILITY') ?? 0) + (byRole.get('WARMUP') ?? 0) + (byRole.get('RECOVERY') ?? 0)).toBeGreaterThanOrEqual(10);
  });

  it('rejects duplicate ADD keys at validation layer', () => {
    const dup = [CATALOG_V3_01C_B_CONTENT[0]!, ...CATALOG_V3_01C_B_CONTENT];
    const report = validateV301cBContentManifest(dup);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'DUPLICATE_KEY')).toBe(true);
  });

  it('requires disposable DB marker for apply guard', () => {
    expect(() =>
      confirmV301cBApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/wt_cat_01c_b',
        { WEIGHT_APP_DISPOSABLE_TEST_DB: '0' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/DISPOSABLE_MARKER_REQUIRED/);
  });
});
