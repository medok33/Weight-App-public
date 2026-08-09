import { describe, expect, it } from 'vitest';
import {
  assertCanApproveTimingProfile,
  assertCanUpdateTimingDraft,
  assertDraftTimingMetadata,
  selectApprovedTimingProfile,
} from '../exercise-energy-timing-profile.lifecycle';
import type { ExerciseEnergyTimingProfileRecord } from '../workout-energy.types';
import {
  ENERGY_TIMING_PILOT_MAPPINGS,
  findEnergyTimingPilotMapping,
} from '../pilot/energy-timing-pilot-manifest';
import { validateEnergyTimingPilotManifest } from '../pilot/energy-timing-pilot-loader';

function draft(
  overrides: Partial<ExerciseEnergyTimingProfileRecord> = {},
): ExerciseEnergyTimingProfileRecord {
  return {
    id: 't1',
    exerciseRevisionId: 'rev-1',
    status: 'DRAFT',
    timingMethod: 'SECONDS_PER_REP',
    secondsPerRep: 2.5,
    sourceType: 'INTERNAL_REVIEWED_POLICY',
    sourceReference: 'Internal reviewed cadence policy',
    sourceVersion: 'cadence-1',
    policyVersion: 'workout-energy-timing-1.0',
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

describe('WORKOUT-ENERGY-01B timing profile lifecycle', () => {
  it('validates internal seconds-per-rep bounds', () => {
    expect(() =>
      assertDraftTimingMetadata({
        exerciseRevisionId: 'rev-1',
        timingMethod: 'SECONDS_PER_REP',
        secondsPerRep: 2.5,
        sourceType: 'INTERNAL_REVIEWED_POLICY',
        sourceReference: 'Internal reviewed cadence',
        sourceVersion: 'v1',
      }),
    ).not.toThrow();
    for (const secondsPerRep of [0, 60.0001, Number.NaN]) {
      expect(() =>
        assertDraftTimingMetadata({
          exerciseRevisionId: 'rev-1',
          timingMethod: 'SECONDS_PER_REP',
          secondsPerRep,
          sourceType: 'INTERNAL_REVIEWED_POLICY',
          sourceReference: 'Internal reviewed cadence',
          sourceVersion: 'v1',
        }),
      ).toThrow(/SECONDS_PER_REP_INVALID/);
    }
  });

  it('requires review and keeps approved rows immutable', () => {
    expect(() => assertCanApproveTimingProfile(draft(), '')).toThrow(/REVIEWER_REQUIRED/);
    expect(() => assertCanApproveTimingProfile(draft(), 'reviewer')).not.toThrow();
    expect(() => assertCanUpdateTimingDraft(draft({ status: 'APPROVED' }))).toThrow(/IMMUTABLE/);
  });

  it('selects only one approved enabled timing profile', () => {
    const approved = draft({
      status: 'APPROVED',
      enabledForCalculation: true,
      reviewedAt: '2026-08-05T01:00:00.000Z',
      reviewedBy: 'reviewer',
      approvedAt: '2026-08-05T01:00:00.000Z',
    });
    expect(
      selectApprovedTimingProfile([draft(), approved], {
        exerciseRevisionId: 'rev-1',
      })?.id,
    ).toBe('t1');
    expect(
      selectApprovedTimingProfile([approved], {
        exerciseRevisionId: 'other-revision',
      }),
    ).toBeNull();
    expect(() =>
      selectApprovedTimingProfile(
        [
          { ...approved, id: 'a' },
          { ...approved, id: 'b' },
        ],
        { exerciseRevisionId: 'rev-1' },
      ),
    ).toThrow(/AMBIGUOUS_TIMING_PROFILE/);
  });
});

describe('WORKOUT-ENERGY-01B timing pilot manifest', () => {
  it('ships zero production timing pilots after FIX-01', () => {
    expect(validateEnergyTimingPilotManifest(ENERGY_TIMING_PILOT_MAPPINGS)).toEqual([]);
    expect(ENERGY_TIMING_PILOT_MAPPINGS).toEqual([]);
    expect(findEnergyTimingPilotMapping('push_ups')).toBeNull();
  });
});
