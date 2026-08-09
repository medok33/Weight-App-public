import { describe, expect, it } from 'vitest';
import { ENERGY_CONTENT_MAPPINGS } from '../energy-content-manifest';
import { ENERGY_PILOT_MAPPINGS } from '../../pilot/energy-pilot-manifest';
import {
  assertNoHardcodedRevisionOneLookup,
  listPublishedReleasePinsFromSoT,
  resolvePublishedPinFromSoT,
} from '../release-pin-resolver';
import { analyseContentCoverage } from '../coverage-analyser';
import { runWorkoutEnergyContentCheck } from '../content-check';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from '../product-policy';
import { withEnergyChecksum } from '../content-checksum';
import { withTimingChecksum } from '../content-checksum';
import { WORKOUT_ENERGY_TIMING_POLICY_VERSION } from '../../workout-energy.types';
import { WORKOUT_ENERGY_CATALOG_RELEASE_KEY } from '../content.types';

describe('release-pin binding', () => {
  it('lists 84 published pins and never substitutes family count', () => {
    const pins = listPublishedReleasePinsFromSoT();
    expect(pins).toHaveLength(84);
    expect(pins).not.toHaveLength(36);
  });

  it('binds all 8 pilots to published revisionNumber=2', () => {
    expect(ENERGY_PILOT_MAPPINGS).toHaveLength(8);
    const pilots = ENERGY_CONTENT_MAPPINGS.filter(
      (row) => row.contentVersion === 'workout-energy-content-01a.1',
    );
    expect(pilots).toHaveLength(8);
    for (const pilot of pilots) {
      expect(pilot.expectedPublishedRevisionNumber).toBe(2);
      const resolved = resolvePublishedPinFromSoT(
        pilot.exerciseKey,
        pilot.expectedPublishedRevisionNumber,
      );
      expect(resolved.status).toBe('OK');
      if (resolved.status === 'OK') {
        expect(resolved.revisionNumber).toBe(2);
      }
    }
  });

  it('binds every energy mapping to its exact published revision pin', () => {
    for (const row of ENERGY_CONTENT_MAPPINGS) {
      const resolved = resolvePublishedPinFromSoT(
        row.exerciseKey,
        row.expectedPublishedRevisionNumber,
      );
      expect(resolved.status).toBe('OK');
      if (resolved.status === 'OK') {
        expect(resolved.revisionNumber).toBe(row.expectedPublishedRevisionNumber);
      }
    }
  });

  it('rejects manifest rev1 when published pin is rev2', () => {
    const result = resolvePublishedPinFromSoT('push_ups', 1);
    expect(result.status).toBe('REVISION_PIN_MISMATCH');
  });

  it('rejects missing and does not name/family fallback', () => {
    expect(resolvePublishedPinFromSoT('not_a_real_exercise_key').status).toBe(
      'MISSING_REVISION_PIN',
    );
    expect(resolvePublishedPinFromSoT('Push Ups').status).toBe('MISSING_REVISION_PIN');
    expect(resolvePublishedPinFromSoT('bodyweight_squat').status).toBe('MISSING_REVISION_PIN');
  });

  it('forbids hardcoded revisionNumber=1 SQL', () => {
    expect(() =>
      assertNoHardcodedRevisionOneLookup(
        `JOIN "ExerciseRevision" r ON r."exerciseId" = e.id AND r."revisionNumber" = 1`,
      ),
    ).toThrow(/HARDCODED_REVISION_NUMBER_1_FORBIDDEN/);
  });
});

describe('coverage analyser + content check', () => {
  it('reports incomplete coverage after 01B timing FIX-01 (partial REPS timing; energy gaps remain)', () => {
    const report = analyseContentCoverage();
    expect(report.totalPins).toBe(84);
    expect(report.generatorVisible).toBe(84);
    expect(report.modeCounts.REPS).toBe(58);
    expect(report.modeCounts.DURATION).toBe(25);
    expect(report.modeCounts.REPS_OR_DURATION).toBe(1);
    expect(report.repositoryEnergyMappings).toBe(ENERGY_CONTENT_MAPPINGS.length);
    expect(report.repositoryTimingMappings).toBe(49);
    expect(report.validEnergyMappings).toBe(ENERGY_CONTENT_MAPPINGS.length);
    expect(report.validTimingMappings).toBe(49);
    expect(report.availableDuration).toBeGreaterThanOrEqual(5);
    expect(report.availableDuration).toBe(22);
    expect(report.availableReps).toBe(49);
    expect(report.missingEnergy).toBe(4);
    expect(report.missingTiming).toBe(9);
    expect(report.unsupportedMode).toBe(1);
    expect(report.coveragePercent).toBe(84.52);
    expect(report.fullCoverageSatisfied).toBe(false);
    expect(report.contentCoverageIncomplete).toBe(true);
    expect(report.workoutV2_01fStatus).toBe('WORKOUT-V2-01F_BLOCKED_BY_ENERGY_CONTENT');
    expect(report.runtimeEnergyAfterMigrationOnly).toBe(0);
    expect(report.runtimeTimingAfterMigrationOnly).toBe(0);

    const wall = report.entries.find((e) => e.exerciseKey === 'wall_angels');
    expect(wall?.energyDisposition).toBe('UNSUPPORTED_REPS_OR_DURATION');
    expect(wall?.blockerCodes).toContain('WALL_ANGELS_TARGET_REPS');
    expect(wall?.blockerCodes).toContain('PRODUCT_MODE_REVISION_REQUIRED');

    const breath = report.entries.find((e) => e.exerciseKey === 'diaphragmatic_breathing');
    expect(breath?.energyDisposition).toBe('NO_DEFENSIBLE_MAPPING');
  });

  it('includes conditional/adaptation/replacement pool as same 84 pins', () => {
    const report = analyseContentCoverage();
    expect(WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.adaptationReplacementIncludedInCoverage).toBe(
      true,
    );
    expect(report.entries.every((e) => e.blockerCodes.includes('CONDITIONAL_GENERATOR_VISIBLE'))).toBe(
      true,
    );
  });

  it('repository mode PASSes with CONTENT_COVERAGE_INCOMPLETE', () => {
    const result = runWorkoutEnergyContentCheck({ mode: 'repository' });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain('CONTENT_COVERAGE_INCOMPLETE');
    expect(result.summary).toContain('WORKOUT-V2-01F_BLOCKED_BY_ENERGY_CONTENT');
  });

  it('strict mode FAILs below 100% and cannot be bypassed by family count', () => {
    const result = runWorkoutEnergyContentCheck({ mode: 'require-full-coverage' });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.report.fullCoverageSatisfied).toBe(false);
    expect(result.summary).toContain('STRICT_FULL_COVERAGE_GATE=FAIL');
  });

  it('strict mode succeeds only with full synthetic coverage fixture', () => {
    const pins = listPublishedReleasePinsFromSoT();
    const energy = pins
      .filter((p) => p.repetitionMode !== 'REPS_OR_DURATION')
      .map((p) =>
        withEnergyChecksum({
          ...ENERGY_CONTENT_MAPPINGS[0]!,
          exerciseKey: p.exerciseKey,
          expectedPublishedRevisionNumber: p.revisionNumber,
          metValue: 3.0,
          compendiumCode: '02056',
          rationale: `synthetic coverage for ${p.exerciseKey}`,
          limitations: 'test fixture only',
          contentVersion: 'test-full-coverage',
          reviewedBy: 'system:test',
          reviewedAt: '2026-08-06',
        }),
      );

    // Force wall_angels as REPS for full coverage fixture (CONTENT-01B will publish real revision).
    const energyWithWall = [
      ...energy,
      withEnergyChecksum({
        ...ENERGY_CONTENT_MAPPINGS[0]!,
        exerciseKey: 'wall_angels',
        expectedPublishedRevisionNumber: 1,
        metValue: 2.8,
        rationale: 'synthetic wall_angels REPS fixture',
        limitations: 'test only — real mode revision belongs in CONTENT-01B',
        contentVersion: 'test-full-coverage',
        reviewedBy: 'system:test',
        reviewedAt: '2026-08-06',
      }),
    ];

    const timing = pins
      .filter((p) => p.repetitionMode === 'REPS')
      .map((p) =>
        withTimingChecksum({
          exerciseKey: p.exerciseKey,
          expectedPublishedRevisionNumber: p.revisionNumber,
          catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
          policyVersion: WORKOUT_ENERGY_TIMING_POLICY_VERSION,
          populationType: 'ADULT_STANDARD_2024',
          contentVersion: 'test-full-coverage',
          timingMethod: 'SECONDS_PER_REP',
          secondsPerRep: 3.0,
          evidenceClass: 'INTERNAL_REVIEWED_TEMPO_POLICY',
          sourceType: 'INTERNAL_REVIEWED_POLICY',
          sourceReference: 'TEST_ONLY_SYNTHETIC_TIMING',
          sourceVersion: 'test-only',
          methodologyVersion: 'workout-energy-timing-reviewed-v1',
          oneRepDefinition: `One complete rep for ${p.exerciseKey}`,
          unilateralSemantics: 'bilateral',
          movementPhases: {
            eccentricSeconds: 1.5,
            bottomTransitionSeconds: 0.1,
            concentricSeconds: 1.0,
            topTransitionSeconds: 0.4,
          },
          phaseModel:
            'eccentricSeconds=1.5000;bottomTransitionSeconds=0.1000;concentricSeconds=1.0000;topTransitionSeconds=0.4000',
          rationale: `movement-specific ${p.exerciseKey}`,
          romAssumptions: 'planned ROM',
          techniqueAssumptions: 'planned technique',
          cadenceAssumptions: '3.0s/rep planned',
          limitations: 'test fixture',
          reviewedBy: 'system:test',
          reviewedAt: '2026-08-06',
          status: 'APPROVED',
        }),
      );

    // Still fails on current SoT because wall_angels remains REPS_OR_DURATION.
    const report = analyseContentCoverage({
      energyMappings: energyWithWall,
      timingMappings: [
        ...timing,
        withTimingChecksum({
          exerciseKey: 'wall_angels',
          expectedPublishedRevisionNumber: 1,
          catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
          policyVersion: WORKOUT_ENERGY_TIMING_POLICY_VERSION,
          populationType: 'ADULT_STANDARD_2024',
          contentVersion: 'test-full-coverage',
          timingMethod: 'SECONDS_PER_REP',
          secondsPerRep: 3.0,
          evidenceClass: 'INTERNAL_REVIEWED_TEMPO_POLICY',
          sourceType: 'INTERNAL_REVIEWED_POLICY',
          sourceReference: 'TEST_ONLY_SYNTHETIC_TIMING',
          sourceVersion: 'test-only',
          methodologyVersion: 'workout-energy-timing-reviewed-v1',
          oneRepDefinition: 'One wall angel cycle',
          unilateralSemantics: 'bilateral',
          movementPhases: {
            eccentricSeconds: 1.5,
            bottomTransitionSeconds: 0.1,
            concentricSeconds: 1.0,
            topTransitionSeconds: 0.4,
          },
          phaseModel:
            'eccentricSeconds=1.5000;bottomTransitionSeconds=0.1000;concentricSeconds=1.0000;topTransitionSeconds=0.4000',
          rationale: 'wall_angels synthetic',
          romAssumptions: 'planned ROM',
          techniqueAssumptions: 'planned technique',
          cadenceAssumptions: '3.0s/rep',
          limitations: 'test',
          reviewedBy: 'system:test',
          reviewedAt: '2026-08-06',
          status: 'APPROVED',
        }),
      ],
    });
    expect(report.unsupportedMode).toBe(1);
    expect(report.fullCoverageSatisfied).toBe(false);
  });

  it('does not count repository mappings as runtime-applied', () => {
    const report = analyseContentCoverage();
    expect(WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.repositoryContentIsNotRuntimeApplied).toBe(true);
    expect(report.runtimeEnergyAfterMigrationOnly).toBe(0);
    expect(report.repositoryEnergyMappings).toBe(ENERGY_CONTENT_MAPPINGS.length);
    expect(report.repositoryEnergyMappings).toBeGreaterThan(8);
  });

  it('security boundaries: check has no userId/weight/network side effects', () => {
    const result = runWorkoutEnergyContentCheck({ mode: 'repository' });
    expect(JSON.stringify(result.report)).not.toMatch(/userId|password|DATABASE_URL/i);
    expect(result.report.entries[0]).not.toHaveProperty('weightKg');
  });
});
