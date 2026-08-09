import { describe, expect, it } from 'vitest';
import {
  canonicalizeEnergyForChecksum,
  computeEnergyContentChecksum,
  computeTimingContentChecksum,
  withEnergyChecksum,
  withTimingChecksum,
} from '../content-checksum';
import { ENERGY_CONTENT_MAPPINGS } from '../energy-content-manifest';
import { TIMING_CONTENT_MAPPINGS } from '../timing-content-manifest';
import {
  validateEnergyContentEntry,
  validateEnergyManifest,
  validateTimingContentEntry,
  validateTimingManifest,
} from '../validate-manifest';
import { WORKOUT_ENERGY_POLICY_VERSION } from '../../workout-energy.types';
import { TIMING_CONTENT_BATCH_02_COUNT } from '../timing-content-batch-02';
import {
  assertSecondsPerRepMatchesPhases,
  serializeTimingPhaseModel,
  sumTimingPhases,
  WORKOUT_ENERGY_TIMING_CONTENT_VERSION,
  WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
  WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION,
  WORKOUT_ENERGY_TIMING_REVIEWED_AT,
  WORKOUT_ENERGY_TIMING_REVIEWED_BY,
  hasHedgedTimingSemantics,
} from '../timing-methodology';
import { timingBase } from './timing-test-fixtures';

describe('energy content checksum', () => {
  it('is deterministic for same content', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    expect(computeEnergyContentChecksum(row)).toBe(row.checksum);
    expect(computeEnergyContentChecksum(row)).toBe(computeEnergyContentChecksum(row));
  });

  it('is field-order independent', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    const a = canonicalizeEnergyForChecksum(row);
    const b = {
      status: row.status,
      metValue: row.metValue,
      exerciseKey: row.exerciseKey,
      rationale: row.rationale,
      limitations: row.limitations,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      contentVersion: row.contentVersion,
      policyVersion: row.policyVersion,
      populationType: row.populationType,
      catalogReleaseKey: row.catalogReleaseKey,
      expectedPublishedRevisionNumber: row.expectedPublishedRevisionNumber,
      calculationMethod: row.calculationMethod,
      compendiumEdition: row.compendiumEdition,
      compendiumCode: row.compendiumCode,
      activityDescriptionEn: row.activityDescriptionEn,
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      sourceVersion: row.sourceVersion,
      mappingClass: row.mappingClass,
    };
    expect(computeEnergyContentChecksum(a as typeof row)).toBe(
      computeEnergyContentChecksum(b as typeof row),
    );
  });

  it('changes when MET changes', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    const mutated = withEnergyChecksum({ ...row, metValue: row.metValue + 0.1 });
    expect(mutated.checksum).not.toBe(row.checksum);
  });

  it('changes when rationale changes', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    const mutated = withEnergyChecksum({ ...row, rationale: `${row.rationale} x` });
    expect(mutated.checksum).not.toBe(row.checksum);
  });

  it('changes when revision changes', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    const mutated = withEnergyChecksum({
      ...row,
      expectedPublishedRevisionNumber: row.expectedPublishedRevisionNumber + 1,
    });
    expect(mutated.checksum).not.toBe(row.checksum);
  });

  it('throws on missing required field', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    expect(() => {
      const missing = { ...row };
      delete (missing as { rationale?: string }).rationale;
      computeEnergyContentChecksum(missing);
    }).toThrow(/CONTENT_CHECKSUM_INVALID_INPUT/);
  });
});

describe('timing content checksum', () => {
  it('changes when secondsPerRep changes', () => {
    const a = withTimingChecksum(timingBase());
    const b = withTimingChecksum(timingBase({ secondsPerRep: 3.5 }));
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('changes when phaseModel / oneRepDefinition change', () => {
    const a = withTimingChecksum(timingBase());
    const b = withTimingChecksum(
      timingBase({
        oneRepDefinition: `${a.oneRepDefinition} alt`,
      }),
    );
    expect(a.checksum).not.toBe(b.checksum);
    const c = withTimingChecksum(
      timingBase({
        movementPhases: {
          eccentricSeconds: 1.6,
          bottomTransitionSeconds: 0.1,
          concentricSeconds: 1.0,
          topTransitionSeconds: 0.3,
        },
        secondsPerRep: 3.0,
      }),
    );
    expect(a.checksum).not.toBe(c.checksum);
  });

  it('production timing manifest has 49 APPROVED entries with valid semantics', () => {
    expect(TIMING_CONTENT_MAPPINGS).toHaveLength(49);
    expect(TIMING_CONTENT_BATCH_02_COUNT).toBe(49);
    expect(validateTimingManifest(TIMING_CONTENT_MAPPINGS)).toEqual([]);
    const allowedVersions = new Set([
      WORKOUT_ENERGY_TIMING_CONTENT_VERSION,
      WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
    ]);
    for (const row of TIMING_CONTENT_MAPPINGS) {
      expect(row.status).toBe('APPROVED');
      expect(row.evidenceClass).toBe('INTERNAL_REVIEWED_TEMPO_POLICY');
      expect(row.methodologyVersion).toBe(WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION);
      expect(row.reviewedBy).toBe(WORKOUT_ENERGY_TIMING_REVIEWED_BY);
      expect(row.reviewedAt).toBe(WORKOUT_ENERGY_TIMING_REVIEWED_AT);
      expect(allowedVersions.has(row.contentVersion)).toBe(true);
      expect(row.phaseModel).toBe(serializeTimingPhaseModel(row.movementPhases));
      expect(row.secondsPerRep).toBeCloseTo(sumTimingPhases(row.movementPhases), 9);
      assertSecondsPerRepMatchesPhases(row.secondsPerRep, row.movementPhases);
      expect(row.oneRepDefinition.trim().length).toBeGreaterThan(0);
      expect(row.romAssumptions.trim().length).toBeGreaterThan(0);
      expect(row.techniqueAssumptions.trim().length).toBeGreaterThan(0);
      expect(row.cadenceAssumptions.trim().length).toBeGreaterThan(0);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
      expect(hasHedgedTimingSemantics(row.unilateralSemantics)).toBe(false);
      expect(hasHedgedTimingSemantics(row.oneRepDefinition)).toBe(false);
      expect(validateTimingContentEntry(row)).toEqual([]);
    }
    const fix02 = TIMING_CONTENT_MAPPINGS.filter(
      (e) => e.contentVersion === WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
    );
    expect(fix02.map((e) => e.exerciseKey).sort()).toEqual([
      'band_row',
      'dumbbell_row',
      'pallof_press_band',
    ]);
  });

  it('rejects hedged unilateralSemantics including discovered FIX-02 patterns', () => {
    const base = TIMING_CONTENT_MAPPINGS[0]!;
    const hedges = [
      'bilateral or unilateral',
      'bilateral (typical) or as catalogued',
      'typically bilateral',
      'depending on variation',
      'as catalogued',
      'per catalog',
    ];
    for (const unilateralSemantics of hedges) {
      const hedged = withTimingChecksum({ ...base, unilateralSemantics });
      expect(
        validateTimingContentEntry(hedged).some((i) => i.code === 'HEDGED_UNILATERAL_SEMANTICS'),
      ).toBe(true);
    }
  });

  it('accepts decisive unilateralSemantics values used in production', () => {
    const base = TIMING_CONTENT_MAPPINGS[0]!;
    for (const unilateralSemantics of [
      'bilateral',
      'unilateral',
      'unilateral (single working arm; brace on other side)',
      'static unilateral stance (side change is not a per-rep phase)',
    ]) {
      const ok = withTimingChecksum({ ...base, unilateralSemantics });
      expect(
        validateTimingContentEntry(ok).some((i) => i.code === 'HEDGED_UNILATERAL_SEMANTICS'),
      ).toBe(false);
    }
  });

  it('rejects hedged oneRepDefinition catalog deferrals', () => {
    const base = TIMING_CONTENT_MAPPINGS[0]!;
    const bad = withTimingChecksum({
      ...base,
      oneRepDefinition: 'One pull of working arm + return (per catalog side accounting)',
    });
    expect(
      validateTimingContentEntry(bad).some((i) => i.code === 'UNPROVEN_CATALOG_COUNTING_REFERENCE'),
    ).toBe(true);
  });

  it('is deterministic after canonical date normalization', () => {
    const a = withTimingChecksum(timingBase({ reviewedAt: '2026-08-06' }));
    const b = withTimingChecksum(timingBase({ reviewedAt: '2026-08-06' }));
    expect(a.checksum).toBe(b.checksum);
    expect(computeTimingContentChecksum(a)).toBe(a.checksum);
  });
});

describe('energy content validation', () => {
  it('accepts all production energy mappings (01A pilots + 01B batch)', () => {
    expect(ENERGY_CONTENT_MAPPINGS.length).toBeGreaterThanOrEqual(8);
    const pilots = ENERGY_CONTENT_MAPPINGS.filter(
      (row) => row.contentVersion === 'workout-energy-content-01a.1',
    );
    expect(pilots).toHaveLength(8);
    for (const row of ENERGY_CONTENT_MAPPINGS) {
      expect(validateEnergyContentEntry(row)).toEqual([]);
      expect(row.policyVersion).toBe(WORKOUT_ENERGY_POLICY_VERSION);
      expect(row.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.status).toBe('APPROVED');
      expect(['DIRECT_MAPPING_DEFENSIBLE', 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION']).toContain(
        row.mappingClass,
      );
    }
    for (const row of pilots) {
      expect(row.expectedPublishedRevisionNumber).toBe(2);
      expect(row.mappingClass).toBe('BROAD_MAPPING_WITH_EXPLICIT_LIMITATION');
    }
  });

  it('rejects missing reviewer/rationale and modified MET checksum', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    expect(
      validateEnergyContentEntry({ ...row, reviewedBy: '' }).some((i) => i.code === 'MISSING_REVIEWER'),
    ).toBe(true);
    expect(
      validateEnergyContentEntry({ ...row, rationale: '' }).some((i) => i.code === 'MISSING_RATIONALE'),
    ).toBe(true);
    expect(
      validateEnergyContentEntry({ ...row, metValue: 9.9 }).some((i) => i.code === 'CHECKSUM_MISMATCH'),
    ).toBe(true);
  });

  it('rejects DRAFT and RETIRED in canonical production energy manifest', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    expect(
      validateEnergyContentEntry({ ...row, status: 'DRAFT' }).some(
        (i) => i.code === 'NON_APPROVED_PRODUCTION_STATUS',
      ),
    ).toBe(true);
    expect(
      validateEnergyContentEntry({ ...row, status: 'RETIRED' }).some(
        (i) => i.code === 'NON_APPROVED_PRODUCTION_STATUS',
      ),
    ).toBe(true);
  });

  it('rejects null and undefined required fields', () => {
    const row = ENERGY_CONTENT_MAPPINGS[0]!;
    expect(
      validateEnergyContentEntry({ ...row, reviewedBy: null }).some((i) => i.code === 'MISSING_REVIEWER'),
    ).toBe(true);
  });

  it('rejects duplicate energy keys', () => {
    const a = ENERGY_CONTENT_MAPPINGS[0]!;
    const issues = validateEnergyManifest([a, a]);
    expect(issues.some((i) => i.code === 'DUPLICATE_ENERGY_EXERCISE_KEY')).toBe(true);
  });
});

describe('timing content validation', () => {
  it('accepts a valid synthetic timing entry', () => {
    const ok = withTimingChecksum(timingBase());
    expect(validateTimingContentEntry(ok)).toEqual([]);
  });

  it('rejects invalid status / wrong release / checksum mismatch', () => {
    expect(
      validateTimingContentEntry(
        withTimingChecksum(timingBase({ status: 'NOT_A_STATUS' as 'APPROVED' })),
      ).some((i) => i.code === 'NON_APPROVED_PRODUCTION_STATUS' || i.code === 'INVALID_STATUS'),
    ).toBe(true);
    expect(
      validateTimingContentEntry(
        withTimingChecksum(timingBase({ catalogReleaseKey: 'wrong-release' })),
      ).some((i) => i.code === 'WRONG_CATALOG_RELEASE'),
    ).toBe(true);
    const probe = {
      ...timingBase(),
      checksum: 'deadbeef',
    };
    expect(validateTimingContentEntry(probe).some((i) => i.code === 'CHECKSUM_MISMATCH')).toBe(
      true,
    );
  });

  it('rejects DRAFT and RETIRED production timing', () => {
    expect(
      validateTimingContentEntry(withTimingChecksum(timingBase({ status: 'DRAFT' }))).some(
        (i) => i.code === 'NON_APPROVED_PRODUCTION_STATUS',
      ),
    ).toBe(true);
    expect(
      validateTimingContentEntry(withTimingChecksum(timingBase({ status: 'RETIRED' }))).some(
        (i) => i.code === 'NON_APPROVED_PRODUCTION_STATUS',
      ),
    ).toBe(true);
  });

  it('rejects undefined/null entry and invalid secondsPerRep', () => {
    expect(validateTimingContentEntry(undefined).some((i) => i.code === 'INVALID_TIMING_ENTRY')).toBe(
      true,
    );
    expect(validateTimingContentEntry(null).some((i) => i.code === 'INVALID_TIMING_ENTRY')).toBe(
      true,
    );
    expect(
      validateTimingContentEntry({
        ...timingBase(),
        secondsPerRep: 0,
        checksum: 'x',
      }).some((i) => i.code === 'INVALID_SECONDS_PER_REP'),
    ).toBe(true);
  });

  it('rejects universal timing markers and missing cadence', () => {
    const universal = withTimingChecksum(
      timingBase({
        sourceReference: 'universal default cadence table',
      }),
    );
    expect(validateTimingContentEntry(universal).some((i) => i.code === 'UNIVERSAL_TIMING_MARKER')).toBe(
      true,
    );
    const bad = withTimingChecksum(
      timingBase({
        cadenceAssumptions: '',
      }),
    );
    expect(validateTimingContentEntry(bad).some((i) => i.code === 'MISSING_CADENCE')).toBe(true);
  });

  it('rejects phase sum mismatch and missing oneRepDefinition', () => {
    const mismatch = {
      ...timingBase(),
      secondsPerRep: 9.9,
      checksum: 'x',
    };
    expect(
      validateTimingContentEntry(mismatch).some((i) => i.code === 'SECONDS_PER_REP_PHASE_MISMATCH'),
    ).toBe(true);
    expect(
      validateTimingContentEntry(
        withTimingChecksum(timingBase({ oneRepDefinition: '' })),
      ).some((i) => i.code === 'MISSING_ONE_REP_DEFINITION'),
    ).toBe(true);
  });

  it('rejects NaN/Infinity/negative secondsPerRep', () => {
    for (const secondsPerRep of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const issues = validateTimingContentEntry({
        ...timingBase(),
        secondsPerRep,
        checksum: 'x',
      });
      expect(issues.some((i) => i.code === 'INVALID_SECONDS_PER_REP')).toBe(true);
    }
  });

  it('rejects duplicate timing keys independent of order', () => {
    const a = withTimingChecksum(timingBase({ contentVersion: 'a' }));
    const b = withTimingChecksum(
      timingBase({
        exerciseKey: 'push_ups',
        contentVersion: 'b',
      }),
    );
    const issues = validateTimingManifest([a, b]);
    expect(issues.some((i) => i.code === 'DUPLICATE_TIMING_EXERCISE_KEY')).toBe(true);
    const reversed = validateTimingManifest([b, a]);
    expect(reversed.some((i) => i.code === 'DUPLICATE_TIMING_EXERCISE_KEY')).toBe(true);
  });
});
