import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { resolveWorkoutEnergyWeight } from '../workout-energy-weight.resolver';
import { selectApprovedEnergyProfile } from '../exercise-energy-profile.lifecycle';
import { selectApprovedTimingProfile } from '../exercise-energy-timing-profile.lifecycle';
import type {
  ExerciseEnergyProfileRecord,
  ExerciseEnergyTimingProfileRecord,
} from '../workout-energy.types';
import { WorkoutEngineController } from '../../controllers/workout-engine.controller';

describe('WORKOUT-ENERGY-01A security boundaries', () => {
  it('USER A never receives USER B weight via resolver', () => {
    const result = resolveWorkoutEnergyWeight({
      userId: 'user-a',
      asOf: '2026-08-05T12:00:00.000Z',
      progressEntries: [
        {
          id: 'b1',
          userId: 'user-b',
          weightKg: 95,
          measuredAt: '2026-08-04T10:00:00.000Z',
        },
      ],
      profile: { userId: 'user-b', weightKg: 95 },
    });
    expect(result.status).toBe('UNAVAILABLE_MISSING_WEIGHT');
    expect(result.weightKg).toBeNull();
  });

  it('guessed revision id cannot select another revision profile', () => {
    const profile: ExerciseEnergyProfileRecord = {
      id: 'p1',
      exerciseRevisionId: 'rev-owned',
      status: 'APPROVED',
      calculationMethod: 'MET_DURATION',
      populationType: 'ADULT_STANDARD_2024',
      compendiumEdition: 'ADULT_2024',
      compendiumCode: '02022',
      metValue: 3.8,
      sourceType: 'COMPENDIUM_ADULT_2024',
      sourceReference: 'ref',
      sourceVersion: 'v1',
      policyVersion: 'workout-energy-1.0',
      enabledForCalculation: true,
      reviewedAt: '2026-08-05T01:00:00.000Z',
      reviewedBy: 'owner',
      approvedAt: '2026-08-05T01:00:00.000Z',
      retiredAt: null,
      retirementReason: null,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T01:00:00.000Z',
    };
    expect(
      selectApprovedEnergyProfile([profile], { exerciseRevisionId: 'rev-guessed' }),
    ).toBeNull();
  });

  it('DRAFT and RETIRED never selected for runtime', () => {
    const draft: ExerciseEnergyProfileRecord = {
      id: 'd1',
      exerciseRevisionId: 'rev-1',
      status: 'DRAFT',
      calculationMethod: 'MET_DURATION',
      populationType: 'ADULT_STANDARD_2024',
      compendiumEdition: 'ADULT_2024',
      compendiumCode: '02022',
      metValue: 3.8,
      sourceType: 'COMPENDIUM_ADULT_2024',
      sourceReference: 'ref',
      sourceVersion: 'v1',
      policyVersion: 'workout-energy-1.0',
      enabledForCalculation: false,
      reviewedAt: null,
      reviewedBy: null,
      approvedAt: null,
      retiredAt: null,
      retirementReason: null,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    };
    const retired = {
      ...draft,
      id: 'r1',
      status: 'RETIRED' as const,
      retiredAt: '2026-08-05T02:00:00.000Z',
    };
    expect(
      selectApprovedEnergyProfile([draft, retired], { exerciseRevisionId: 'rev-1' }),
    ).toBeNull();
  });

  it('timing profile selection remains revision-scoped', () => {
    const profile: ExerciseEnergyTimingProfileRecord = {
      id: 't1',
      exerciseRevisionId: 'rev-owned',
      status: 'APPROVED',
      timingMethod: 'SECONDS_PER_REP',
      secondsPerRep: 2.5,
      sourceType: 'INTERNAL_REVIEWED_POLICY',
      sourceReference: 'Internal reviewed cadence',
      sourceVersion: 'cadence-1',
      policyVersion: 'workout-energy-timing-1.0',
      enabledForCalculation: true,
      reviewedAt: '2026-08-05T01:00:00.000Z',
      reviewedBy: 'owner',
      approvedAt: '2026-08-05T01:00:00.000Z',
      retiredAt: null,
      retirementReason: null,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T01:00:00.000Z',
    };
    expect(
      selectApprovedTimingProfile([profile], { exerciseRevisionId: 'rev-guessed' }),
    ).toBeNull();
  });

  it('does not expose timing profile mutation on the USER workout controller', () => {
    const routePaths = Object.getOwnPropertyNames(WorkoutEngineController.prototype)
      .filter((name) => name !== 'constructor')
      .flatMap((name) => {
        const handler = Object.getOwnPropertyDescriptor(
          WorkoutEngineController.prototype,
          name,
        )?.value;
        const path = handler ? Reflect.getMetadata(PATH_METADATA, handler) : undefined;
        return path == null ? [] : [String(path)];
      });
    expect(routePaths.some((path) => /timing|energy[-_]?profile/i.test(path))).toBe(false);
  });
});
