import { describe, expect, it } from 'vitest';
import { analyseContentCoverage } from '../coverage-analyser';
import { runWorkoutEnergyContentCheck } from '../content-check';
import { ENERGY_CONTENT_MAPPINGS } from '../energy-content-manifest';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from '../product-policy';
import { validateContentPolicy } from '../validate-content-policy';
import { approvedTiming } from './timing-test-fixtures';

describe('executable content policy (WEC-02)', () => {
  it('accepts the repository product policy', () => {
    expect(validateContentPolicy()).toEqual([]);
  });

  it.each([
    ['universalTimingAllowed', true, 'POLICY_UNIVERSAL_TIMING_ALLOWED'],
    ['familyFallbackAllowed', true, 'POLICY_FAMILY_FALLBACK_ALLOWED'],
    ['nameFallbackAllowed', true, 'POLICY_NAME_FALLBACK_ALLOWED'],
    ['estimatedDurationFallbackAllowed', true, 'POLICY_ESTIMATED_DURATION_FALLBACK_ALLOWED'],
    ['partialCoverageAllowed', true, 'POLICY_PARTIAL_COVERAGE_ALLOWED'],
    ['requiredCoveragePercent', 99.99, 'POLICY_REQUIRED_COVERAGE_PERCENT'],
    ['coverageRequirement', 'PARTIAL', 'POLICY_COVERAGE_REQUIREMENT'],
    ['wallAngelsTargetMode', 'DURATION', 'POLICY_WALL_ANGELS_TARGET_MODE'],
    ['sessionTotalPolicy', 'ALWAYS_SHOW_TOTAL', 'POLICY_SESSION_TOTAL_UNKNOWN'],
    ['repsTimingPolicy', 'UNIVERSAL_DEFAULT', 'POLICY_REPS_TIMING_UNKNOWN'],
  ] as const)('fails closed for %s', (field, value, code) => {
    const mutated = {
      ...WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY,
      [field]: value,
    };
    expect(validateContentPolicy(mutated).some((i) => i.code === code)).toBe(true);
  });

  it('propagates policy failure to CLI exit in repository mode', () => {
    const result = runWorkoutEnergyContentCheck({
      mode: 'repository',
      productPolicy: {
        ...WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY,
        partialCoverageAllowed: true,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.report.issues.some((i) => i.surface === 'policy')).toBe(true);
  });
});

describe('energy/timing error isolation (WEC-03)', () => {
  it('keeps valid timing disposition when energy is invalid for same exercise', () => {
    // empty rationale fails validation — keep original checksum so mismatch is not the focus
    const invalidEnergy = {
      ...ENERGY_CONTENT_MAPPINGS[0]!,
      exerciseKey: 'push_ups',
      rationale: '',
    };
    const timing = approvedTiming('push_ups', 3.0);
    const report = analyseContentCoverage({
      energyMappings: [invalidEnergy],
      timingMappings: [timing],
    });
    const pin = report.entries.find((e) => e.exerciseKey === 'push_ups');
    expect(pin?.energyDisposition).toBe('INVALID_ENERGY_MAPPING');
    expect(pin?.timingDisposition).not.toBe('INVALID_TIMING_MAPPING');
    expect(report.issues.some((i) => i.surface === 'energy' && i.exerciseKey === 'push_ups')).toBe(
      true,
    );
    expect(
      report.issues.some(
        (i) => i.surface === 'timing' && i.exerciseKey === 'push_ups' && i.level === 'error',
      ),
    ).toBe(false);
  });

  it('keeps valid energy disposition when timing is invalid', () => {
    const energy = ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === 'push_ups')!;
    const invalidTiming = {
      ...approvedTiming('push_ups'),
      status: 'NOT_A_STATUS',
    };
    const report = analyseContentCoverage({
      energyMappings: [energy],
      timingMappings: [invalidTiming as ReturnType<typeof approvedTiming>],
    });
    const pin = report.entries.find((e) => e.exerciseKey === 'push_ups');
    expect(pin?.timingDisposition).toBe('INVALID_TIMING_MAPPING');
    expect(pin?.energyDisposition).not.toBe('INVALID_ENERGY_MAPPING');
  });

  it('marks both invalid when energy and timing fail independently', () => {
    const invalidEnergy = {
      ...ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === 'push_ups')!,
      status: 'DRAFT' as const,
    };
    const invalidTiming = {
      ...approvedTiming('push_ups'),
      catalogReleaseKey: 'wrong-release',
    };
    const report = analyseContentCoverage({
      energyMappings: [invalidEnergy],
      timingMappings: [invalidTiming as ReturnType<typeof approvedTiming>],
    });
    const pin = report.entries.find((e) => e.exerciseKey === 'push_ups');
    expect(pin?.energyDisposition).toBe('INVALID_ENERGY_MAPPING');
    expect(pin?.timingDisposition).toBe('INVALID_TIMING_MAPPING');
  });

  it('does not cross-contaminate unrelated exercises', () => {
    const pushUps = ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === 'push_ups')!;
    const squats = ENERGY_CONTENT_MAPPINGS.find((e) => e.exerciseKey === 'bodyweight_squats')!;
    const badPushUps = { ...pushUps, status: 'DRAFT' as const };
    const report = analyseContentCoverage({
      energyMappings: [badPushUps, squats],
      timingMappings: [],
    });
    const squatPin = report.entries.find((e) => e.exerciseKey === 'bodyweight_squats');
    const pushPin = report.entries.find((e) => e.exerciseKey === 'push_ups');
    expect(pushPin?.energyDisposition).toBe('INVALID_ENERGY_MAPPING');
    expect(squatPin?.energyDisposition).not.toBe('INVALID_ENERGY_MAPPING');
  });

  it('empty production timing manifest does not invent timing errors', () => {
    const report = analyseContentCoverage({
      energyMappings: ENERGY_CONTENT_MAPPINGS,
      timingMappings: [],
    });
    expect(report.issues.filter((i) => i.surface === 'timing')).toEqual([]);
    expect(report.repositoryTimingMappings).toBe(0);
  });
});

describe('universal timing semantics (WEC-08)', () => {
  it('does not default missing timing to 2.5', () => {
    const report = analyseContentCoverage({
      energyMappings: ENERGY_CONTENT_MAPPINGS,
      timingMappings: [],
    });
    const push = report.entries.find((e) => e.exerciseKey === 'push_ups');
    expect(push?.timingDisposition).toBe('MISSING_TIMING_PROFILE');
    expect(report.validTimingMappings).toBe(0);
  });

  it('does not reuse one timing entry for another exercise', () => {
    const report = analyseContentCoverage({
      energyMappings: ENERGY_CONTENT_MAPPINGS,
      timingMappings: [approvedTiming('push_ups', 2.5)],
    });
    const squats = report.entries.find((e) => e.exerciseKey === 'bodyweight_squats');
    expect(squats?.timingDisposition).toBe('MISSING_TIMING_PROFILE');
    const push = report.entries.find((e) => e.exerciseKey === 'push_ups');
    expect(push?.timingDisposition).toBe('AVAILABLE_REPS');
  });

  it('allows independent exercises to share the same numeric secondsPerRep', () => {
    const report = analyseContentCoverage({
      energyMappings: ENERGY_CONTENT_MAPPINGS,
      timingMappings: [
        approvedTiming('push_ups', 2.5),
        approvedTiming('bodyweight_squats', 2.5),
      ],
    });
    expect(
      report.entries.find((e) => e.exerciseKey === 'push_ups')?.timingDisposition,
    ).toBe('AVAILABLE_REPS');
    expect(
      report.entries.find((e) => e.exerciseKey === 'bodyweight_squats')?.timingDisposition,
    ).toBe('AVAILABLE_REPS');
  });
});

describe('WEC-06 / WEC-09 dispositions', () => {
  it('keeps farmer_carry_dumbbell as NO_DEFENSIBLE_MAPPING without fake MET', () => {
    expect(
      ENERGY_CONTENT_MAPPINGS.some((e) => e.exerciseKey === 'farmer_carry_dumbbell'),
    ).toBe(false);
    const report = analyseContentCoverage();
    const farmer = report.entries.find((e) => e.exerciseKey === 'farmer_carry_dumbbell');
    expect(farmer?.energyDisposition).toBe('NO_DEFENSIBLE_MAPPING');
  });

  it('keeps diaphragmatic_breathing as NO_DEFENSIBLE_MAPPING without fake MET', () => {
    const report = analyseContentCoverage();
    const breath = report.entries.find((e) => e.exerciseKey === 'diaphragmatic_breathing');
    expect(breath?.energyDisposition).toBe('NO_DEFENSIBLE_MAPPING');
    expect(ENERGY_CONTENT_MAPPINGS.some((e) => e.exerciseKey === 'diaphragmatic_breathing')).toBe(
      false,
    );
  });

  it('documents repository mode as the verify gate (strict remains coverage FAIL)', () => {
    const repo = runWorkoutEnergyContentCheck({ mode: 'repository' });
    const strict = runWorkoutEnergyContentCheck({ mode: 'require-full-coverage' });
    expect(repo.ok).toBe(true);
    expect(strict.ok).toBe(false);
    expect(strict.report.contentCoverageIncomplete).toBe(true);
  });
});
