import { describe, expect, it } from 'vitest';
import {
  assertCanApprove,
  assertCanUpdateDraft,
  assertDraftEnergyMetadata,
  selectApprovedEnergyProfile,
} from '../exercise-energy-profile.lifecycle';
import type { ExerciseEnergyProfileRecord } from '../workout-energy.types';
import {
  ENERGY_PILOT_MAPPINGS,
  ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS,
  findEnergyPilotMapping,
} from '../pilot/energy-pilot-manifest';

function draft(overrides: Partial<ExerciseEnergyProfileRecord> = {}): ExerciseEnergyProfileRecord {
  return {
    id: 'p1',
    exerciseRevisionId: 'rev-1',
    status: 'DRAFT',
    calculationMethod: 'MET_DURATION',
    populationType: 'ADULT_STANDARD_2024',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: '02022',
    metValue: 3.8,
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: 'https://pacompendium.com/',
    sourceVersion: 'compendium-adult-2024.1',
    policyVersion: 'workout-energy-1.0',
    enabledForCalculation: false,
    reviewedAt: null,
    reviewedBy: null,
    approvedAt: null,
    retiredAt: null,
    retirementReason: null,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('WORKOUT-ENERGY-01A energy profile lifecycle', () => {
  it('validates draft metadata and rejects invalid Compendium codes/MET', () => {
    expect(() =>
      assertDraftEnergyMetadata({
        exerciseRevisionId: 'rev-1',
        calculationMethod: 'MET_DURATION',
        populationType: 'ADULT_STANDARD_2024',
        compendiumEdition: 'ADULT_2024',
        compendiumCode: '02022',
        metValue: 3.8,
        sourceType: 'COMPENDIUM_ADULT_2024',
        sourceReference: 'ref',
        sourceVersion: 'v1',
      }),
    ).not.toThrow();

    expect(() =>
      assertDraftEnergyMetadata({
        exerciseRevisionId: 'rev-1',
        calculationMethod: 'MET_DURATION',
        populationType: 'ADULT_STANDARD_2024',
        compendiumEdition: 'ADULT_2024',
        compendiumCode: 'abc',
        metValue: 3.8,
        sourceType: 'COMPENDIUM_ADULT_2024',
        sourceReference: 'ref',
        sourceVersion: 'v1',
      }),
    ).toThrow(/COMPENDIUM_CODE/);

    expect(() =>
      assertDraftEnergyMetadata({
        exerciseRevisionId: 'rev-1',
        calculationMethod: 'MET_DURATION',
        populationType: 'ADULT_STANDARD_2024',
        compendiumEdition: 'ADULT_2024',
        compendiumCode: '02022',
        metValue: -1,
        sourceType: 'COMPENDIUM_ADULT_2024',
        sourceReference: 'ref',
        sourceVersion: 'v1',
      }),
    ).toThrow(/MET_INVALID/);
  });

  it('requires reviewer for approval and blocks approved mutation', () => {
    const row = draft();
    expect(() => assertCanApprove(row, '')).toThrow(/REVIEWER/);
    expect(() => assertCanApprove(row, 'owner@example.com')).not.toThrow();
    expect(() => assertCanUpdateDraft(draft({ status: 'APPROVED' }))).toThrow(/IMMUTABLE/);
  });

  it('selects only approved+enabled profiles and rejects ambiguity', () => {
    const approved = draft({
      status: 'APPROVED',
      enabledForCalculation: true,
      reviewedAt: '2026-08-05T01:00:00.000Z',
      reviewedBy: 'owner',
      approvedAt: '2026-08-05T01:00:00.000Z',
    });
    expect(
      selectApprovedEnergyProfile([draft(), approved], { exerciseRevisionId: 'rev-1' })?.id,
    ).toBe('p1');

    expect(
      selectApprovedEnergyProfile(
        [draft({ status: 'RETIRED', enabledForCalculation: false })],
        { exerciseRevisionId: 'rev-1' },
      ),
    ).toBeNull();

    expect(() =>
      selectApprovedEnergyProfile(
        [
          { ...approved, id: 'a' },
          { ...approved, id: 'b' },
        ],
        { exerciseRevisionId: 'rev-1' },
      ),
    ).toThrow(/INVALID_ENERGY_PROFILE/);
  });
});

describe('WORKOUT-ENERGY-01A pilot manifest', () => {
  it('covers 6–12 reviewed mappings with exact unmodified MET codes', () => {
    expect(ENERGY_PILOT_MAPPINGS.length).toBeGreaterThanOrEqual(6);
    expect(ENERGY_PILOT_MAPPINGS.length).toBeLessThanOrEqual(12);
    for (const row of ENERGY_PILOT_MAPPINGS) {
      expect(row.compendiumEdition).toBe('ADULT_2024');
      expect(row.compendiumCode).toMatch(/^\d{5}$/);
      expect(row.metValue).toBeGreaterThan(0);
      expect(row.sourceReference).toMatch(/pacompendium\.com/i);
      expect(findEnergyPilotMapping(row.exerciseKey)?.metValue).toBe(row.metValue);
    }
  });

  it('keeps unsupported pilot keys without mapping', () => {
    for (const key of ENERGY_PILOT_UNSUPPORTED_EXERCISE_KEYS) {
      expect(findEnergyPilotMapping(key)).toBeNull();
    }
  });

  it('does not invent MET from exercise key alone', () => {
    expect(findEnergyPilotMapping('unknown_made_up_exercise')).toBeNull();
  });
});
