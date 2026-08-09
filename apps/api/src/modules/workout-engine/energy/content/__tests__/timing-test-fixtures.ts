/**
 * Shared synthetic timing fixtures for unit tests.
 * Production entries live in timing-content-batch-02.ts — do not use these as SoT.
 */
import { withTimingChecksum } from '../content-checksum';
import {
  WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
  type TimingContentEntry,
  type TimingMovementPhases,
} from '../content.types';
import {
  serializeTimingPhaseModel,
  sumTimingPhases,
  WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION,
} from '../timing-methodology';
import { WORKOUT_ENERGY_TIMING_POLICY_VERSION } from '../../workout-energy.types';

/** Build an explicit phase set whose sum equals secondsPerRep (4dp). */
export function timingTestPhases(
  secondsPerRep = 3.0,
  phases?: TimingMovementPhases,
): { secondsPerRep: number; movementPhases: TimingMovementPhases; phaseModel: string } {
  const target = Number(secondsPerRep.toFixed(4));
  if (phases) {
    const sum = Number(sumTimingPhases(phases).toFixed(4));
    if (Math.abs(sum - target) > 1e-9) {
      throw new Error(`TIMING_TEST_PHASE_SUM_MISMATCH:${target}!=${sum}`);
    }
    return {
      secondsPerRep: target,
      movementPhases: phases,
      phaseModel: serializeTimingPhaseModel(phases),
    };
  }

  // Deterministic split: eccentric 40%, concentric 35%, bottom 10%, top remainder.
  const eccentricSeconds = Number((target * 0.4).toFixed(4));
  const concentricSeconds = Number((target * 0.35).toFixed(4));
  const bottomTransitionSeconds = Number((target * 0.1).toFixed(4));
  const topTransitionSeconds = Number(
    (target - eccentricSeconds - concentricSeconds - bottomTransitionSeconds).toFixed(4),
  );
  const built: TimingMovementPhases = {
    eccentricSeconds,
    bottomTransitionSeconds,
    concentricSeconds,
    topTransitionSeconds,
  };
  if (topTransitionSeconds < 0) {
    throw new Error(`TIMING_TEST_PHASE_NEGATIVE_TOP:${target}`);
  }
  return {
    secondsPerRep: target,
    movementPhases: built,
    phaseModel: serializeTimingPhaseModel(built),
  };
}

export function timingBase(
  overrides: Partial<Omit<TimingContentEntry, 'checksum'>> = {},
): Omit<TimingContentEntry, 'checksum'> {
  const secondsPerRep =
    typeof overrides.secondsPerRep === 'number' ? overrides.secondsPerRep : 3.0;
  const phaseBundle =
    overrides.movementPhases != null
      ? timingTestPhases(
          overrides.secondsPerRep ?? sumTimingPhases(overrides.movementPhases),
          overrides.movementPhases,
        )
      : timingTestPhases(secondsPerRep);

  return {
    exerciseKey: 'push_ups',
    expectedPublishedRevisionNumber: 2,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_TIMING_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: 'test-timing-1',
    timingMethod: 'SECONDS_PER_REP',
    evidenceClass: 'INTERNAL_REVIEWED_TEMPO_POLICY',
    sourceType: 'INTERNAL_REVIEWED_POLICY',
    sourceReference: 'TEST_ONLY_SYNTHETIC_TIMING fixture',
    sourceVersion: 'test-only-1',
    methodologyVersion: WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION,
    oneRepDefinition: 'One controlled push-up cycle: lower + press to start',
    unilateralSemantics: 'bilateral',
    rationale: 'movement-specific test tempo',
    romAssumptions: 'full push-up ROM',
    techniqueAssumptions: 'controlled tempo',
    cadenceAssumptions: `${phaseBundle.secondsPerRep}s planned per rep from explicit phases`,
    limitations: 'test only',
    reviewedBy: 'system:test',
    reviewedAt: '2026-08-06',
    status: 'APPROVED',
    ...overrides,
    secondsPerRep: phaseBundle.secondsPerRep,
    movementPhases: phaseBundle.movementPhases,
    phaseModel: overrides.phaseModel ?? phaseBundle.phaseModel,
  };
}

export function approvedTiming(exerciseKey: string, secondsPerRep = 2.5) {
  return withTimingChecksum(
    timingBase({
      exerciseKey,
      secondsPerRep,
      contentVersion: 'test-timing-hardening',
      sourceReference: `movement-specific ${exerciseKey} reviewed tempo`,
      sourceVersion: 'test-only',
      rationale: `exact ${exerciseKey} cadence from movement-specific evidence`,
      cadenceAssumptions: `${secondsPerRep}s/rep movement-specific`,
      limitations: 'test fixture',
    }),
  );
}
