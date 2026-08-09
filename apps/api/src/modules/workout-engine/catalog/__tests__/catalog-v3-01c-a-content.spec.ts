/**
 * CATALOG-V3-01C-A — unit validation of Batch A NEW content SoT.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG_V3_01C_A_CONTENT,
  CATALOG_V3_01C_A_EXPECTED_COUNT,
  CATALOG_V3_01C_A_HELD,
  CATALOG_V3_01C_A_VERSION,
} from '../catalog-v3-01c-a-content';
import { validateV301cAContentManifest } from '../catalog-v3-01c-a-content.validation';
import { WORKOUT_CATALOG_MANIFEST } from '../catalog-manifest';
import { confirmV301cAApplyDatabase } from '../catalog-v3-01c-a-content-loader';

describe('CATALOG-V3-01C-A content SoT', () => {
  it('validates exact Batch A count with complete V3 metadata', () => {
    const report = validateV301cAContentManifest();
    expect(report.ok, JSON.stringify(report.issues.slice(0, 12))).toBe(true);
    expect(report.entryCount).toBe(CATALOG_V3_01C_A_EXPECTED_COUNT);
    expect(report.entryCount).toBe(40);
    expect(report.version).toBe(CATALOG_V3_01C_A_VERSION);
  });

  it('does not collide with existing 84 catalog keys', () => {
    const existing = new Set(
      WORKOUT_CATALOG_MANIFEST.map((e) => e.legacyExerciseKey ?? e.slug),
    );
    for (const e of CATALOG_V3_01C_A_CONTENT) {
      expect(existing.has(e.exerciseKey), e.exerciseKey).toBe(false);
    }
  });

  it('keeps held ADD candidates out of the authored set', () => {
    const authored = new Set(CATALOG_V3_01C_A_CONTENT.map((e) => e.exerciseKey));
    expect(CATALOG_V3_01C_A_HELD.length).toBeGreaterThanOrEqual(5);
    for (const h of CATALOG_V3_01C_A_HELD) {
      expect(authored.has(h.exerciseKey), h.exerciseKey).toBe(false);
      expect(h.reason).toContain('BATCH_A_HELD_FOR_IDENTITY_REVIEW');
    }
  });

  it('does not fabricate readiness / energy claims in SoT', () => {
    for (const e of CATALOG_V3_01C_A_CONTENT) {
      expect(e).not.toHaveProperty('readiness');
      expect(e).not.toHaveProperty('generatorReady');
      expect(e).not.toHaveProperty('energyReady');
      expect(e.techniqueRu.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('rejects duplicate ADD keys at validation layer', () => {
    const dup = [
      CATALOG_V3_01C_A_CONTENT[0]!,
      ...CATALOG_V3_01C_A_CONTENT,
    ];
    const report = validateV301cAContentManifest(dup);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'DUPLICATE_KEY')).toBe(true);
  });

  it('requires disposable DB marker for apply guard', () => {
    expect(() =>
      confirmV301cAApplyDatabase(
        'postgresql://postgres:postgres@127.0.0.1:5432/wt_cat_01c_a',
        { WEIGHT_APP_DISPOSABLE_TEST_DB: '0' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/DISPOSABLE_MARKER_REQUIRED/);
  });
});
