/**
 * Coverage analyser — repository content vs published release pins.
 * Repository mappings are NOT treated as runtime-applied DB coverage.
 */
import { ENERGY_CONTENT_DISPOSITIONS, ENERGY_CONTENT_MAPPINGS } from './energy-content-manifest';
import { TIMING_CONTENT_MAPPINGS } from './timing-content-manifest';
import { listPublishedReleasePinsFromSoT, resolvePublishedPinFromSoT } from './release-pin-resolver';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from './product-policy';
import {
  validateContentPolicy,
  type ContentPolicyProbe,
} from './validate-content-policy';
import { validateEnergyManifest, validateTimingManifest } from './validate-manifest';
import {
  WORKOUT_ENERGY_CONTENT_REPORT_VERSION,
  type ContentCoveragePinResult,
  type ContentCoverageReport,
  type ContentValidationIssue,
  type CoverageDisposition,
  type EnergyContentEntry,
  type TimingContentEntry,
} from './content.types';

export type AnalyseCoverageInput = {
  energyMappings?: readonly EnergyContentEntry[];
  timingMappings?: readonly TimingContentEntry[];
  generatedFromCommit?: string | null;
  /** Test-only: inject a mutated policy object for fail-closed probes. */
  productPolicy?: ContentPolicyProbe;
};

function hasSurfaceErrors(
  issues: ContentValidationIssue[],
  surface: ContentValidationIssue['surface'],
  exerciseKey: string,
): boolean {
  return issues.some(
    (i) => i.surface === surface && i.exerciseKey === exerciseKey && i.level === 'error',
  );
}

/**
 * Index by exerciseKey only when unique. Duplicates are reported by validators
 * and must never last-wins overwrite.
 */
function indexUniqueByExerciseKey<T extends { exerciseKey: string }>(
  entries: readonly T[],
  duplicateKeys: ReadonlySet<string>,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) {
    if (duplicateKeys.has(entry.exerciseKey)) {
      continue;
    }
    if (map.has(entry.exerciseKey)) {
      continue;
    }
    map.set(entry.exerciseKey, entry);
  }
  return map;
}

function duplicateKeysFromIssues(
  issues: ContentValidationIssue[],
  code: string,
): Set<string> {
  return new Set(
    issues.filter((i) => i.code === code).map((i) => i.exerciseKey).filter((k) => k !== '*'),
  );
}

export function analyseContentCoverage(input: AnalyseCoverageInput = {}): ContentCoverageReport {
  const energyMappings = input.energyMappings ?? ENERGY_CONTENT_MAPPINGS;
  const timingMappings = input.timingMappings ?? TIMING_CONTENT_MAPPINGS;
  const policy = input.productPolicy ?? WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY;
  const pins = listPublishedReleasePinsFromSoT();

  // Policy validation before coverage analysis (repository + strict).
  const issues: ContentValidationIssue[] = [
    ...validateContentPolicy(policy),
    ...validateEnergyManifest(energyMappings),
    ...validateTimingManifest(timingMappings),
  ];

  const energyDuplicateKeys = duplicateKeysFromIssues(issues, 'DUPLICATE_ENERGY_EXERCISE_KEY');
  const timingDuplicateKeys = duplicateKeysFromIssues(issues, 'DUPLICATE_TIMING_EXERCISE_KEY');
  const energyMap = indexUniqueByExerciseKey(energyMappings, energyDuplicateKeys);
  const timingMap = indexUniqueByExerciseKey(timingMappings, timingDuplicateKeys);
  const dispositionByKey = new Map(
    ENERGY_CONTENT_DISPOSITIONS.map((d) => [d.exerciseKey, d] as const),
  );

  const modeCounts = { REPS: 0, DURATION: 0, REPS_OR_DURATION: 0 };
  const entries: ContentCoveragePinResult[] = [];

  for (const pin of pins) {
    modeCounts[pin.repetitionMode] += 1;
    const blockers = new Set<string>();
    let energyDisposition: CoverageDisposition = 'MISSING_ENERGY_PROFILE';
    let timingDisposition: CoverageDisposition | 'NOT_REQUIRED' = 'NOT_REQUIRED';
    let expectedEstimateStatus = 'UNAVAILABLE_MISSING_ENERGY_PROFILE';

    if (!pin.enabledForGenerator) {
      blockers.add('NOT_GENERATOR_VISIBLE');
    } else {
      blockers.add('CONDITIONAL_GENERATOR_VISIBLE');
    }

    if (pin.repetitionMode === 'REPS_OR_DURATION') {
      energyDisposition = 'UNSUPPORTED_REPS_OR_DURATION';
      timingDisposition = 'PRODUCT_MODE_REVISION_REQUIRED';
      blockers.add('UNSUPPORTED_REPS_OR_DURATION');
      blockers.add('PRODUCT_MODE_REVISION_REQUIRED');
      if (pin.exerciseKey === policy.wallAngelsExerciseKey) {
        blockers.add('WALL_ANGELS_TARGET_REPS');
      }
      expectedEstimateStatus = 'INVALID_PLAN_PRESCRIPTION';
      entries.push({
        exerciseKey: pin.exerciseKey,
        revisionNumber: pin.revisionNumber,
        revisionId: null,
        repetitionMode: pin.repetitionMode,
        enabledForGenerator: pin.enabledForGenerator,
        energyDisposition,
        timingDisposition,
        expectedEstimateStatus,
        blockerCodes: [...blockers],
      });
      continue;
    }

    const energy = energyMap.get(pin.exerciseKey);
    if (!energy) {
      if (dispositionByKey.get(pin.exerciseKey)?.disposition === 'NO_DEFENSIBLE_MAPPING') {
        energyDisposition = 'NO_DEFENSIBLE_MAPPING';
        blockers.add('NO_DEFENSIBLE_MAPPING');
      } else {
        energyDisposition = 'MISSING_ENERGY_PROFILE';
        blockers.add('MISSING_ENERGY_PROFILE');
      }
      expectedEstimateStatus = 'UNAVAILABLE_MISSING_ENERGY_PROFILE';
    } else {
      const pinResolve = resolvePublishedPinFromSoT(
        pin.exerciseKey,
        energy.expectedPublishedRevisionNumber,
      );
      if (pinResolve.status !== 'OK') {
        energyDisposition = pinResolve.status;
        blockers.add(pinResolve.status);
        expectedEstimateStatus = 'INVALID_ENERGY_PROFILE';
      } else if (
        energy.status !== 'APPROVED' ||
        hasSurfaceErrors(issues, 'energy', pin.exerciseKey)
      ) {
        energyDisposition = 'INVALID_ENERGY_MAPPING';
        blockers.add('INVALID_ENERGY_MAPPING');
        expectedEstimateStatus = 'INVALID_ENERGY_PROFILE';
      } else if (pin.repetitionMode === 'DURATION') {
        if (pin.defaultDurationSeconds != null && pin.defaultDurationSeconds > 0) {
          energyDisposition = 'AVAILABLE_DURATION';
          expectedEstimateStatus = 'AVAILABLE';
        } else {
          energyDisposition = 'INVALID_ENERGY_MAPPING';
          blockers.add('MISSING_CANONICAL_DURATION');
          expectedEstimateStatus = 'INVALID_PLAN_PRESCRIPTION';
        }
      } else {
        // REPS: energy ok, need timing
        energyDisposition = 'MISSING_TIMING_PROFILE';
        expectedEstimateStatus = 'UNAVAILABLE_MISSING_ACTIVE_DURATION';
      }
    }

    if (pin.repetitionMode === 'REPS') {
      const timing = timingMap.get(pin.exerciseKey);
      if (!timing) {
        timingDisposition = 'MISSING_TIMING_PROFILE';
        blockers.add('MISSING_TIMING_PROFILE');
        if (
          energyDisposition !== 'MISSING_ENERGY_PROFILE' &&
          energyDisposition !== 'NO_DEFENSIBLE_MAPPING' &&
          energyDisposition !== 'REVISION_PIN_MISMATCH' &&
          energyDisposition !== 'INVALID_ENERGY_MAPPING'
        ) {
          energyDisposition = 'MISSING_TIMING_PROFILE';
        }
        expectedEstimateStatus = energy
          ? 'UNAVAILABLE_MISSING_ACTIVE_DURATION'
          : expectedEstimateStatus;
      } else {
        const pinResolve = resolvePublishedPinFromSoT(
          pin.exerciseKey,
          timing.expectedPublishedRevisionNumber,
        );
        if (pinResolve.status !== 'OK') {
          timingDisposition = pinResolve.status;
          blockers.add(pinResolve.status);
          expectedEstimateStatus = 'AMBIGUOUS_TIMING_PROFILE';
        } else if (
          timing.status !== 'APPROVED' ||
          hasSurfaceErrors(issues, 'timing', pin.exerciseKey)
        ) {
          timingDisposition = 'INVALID_TIMING_MAPPING';
          blockers.add('INVALID_TIMING_MAPPING');
        } else if (
          energy &&
          energy.status === 'APPROVED' &&
          !hasSurfaceErrors(issues, 'energy', pin.exerciseKey)
        ) {
          const energyPin = resolvePublishedPinFromSoT(
            pin.exerciseKey,
            energy.expectedPublishedRevisionNumber,
          );
          if (energyPin.status === 'OK') {
            timingDisposition = 'AVAILABLE_REPS';
            energyDisposition = 'AVAILABLE_REPS';
            expectedEstimateStatus = 'AVAILABLE';
            blockers.delete('MISSING_TIMING_PROFILE');
          }
        } else {
          // Timing entry is structurally valid; energy disposition stays independent.
          blockers.delete('MISSING_TIMING_PROFILE');
          timingDisposition = 'MISSING_ENERGY_PROFILE';
        }
      }
    }

    entries.push({
      exerciseKey: pin.exerciseKey,
      revisionNumber: pin.revisionNumber,
      revisionId: null,
      repetitionMode: pin.repetitionMode,
      enabledForGenerator: pin.enabledForGenerator,
      energyDisposition,
      timingDisposition,
      expectedEstimateStatus,
      blockerCodes: [...blockers],
    });
  }

  const validEnergyMappings = energyMappings.filter((energy) => {
    if (energyDuplicateKeys.has(energy.exerciseKey)) return false;
    const pinResolve = resolvePublishedPinFromSoT(
      energy.exerciseKey,
      energy.expectedPublishedRevisionNumber,
    );
    return (
      pinResolve.status === 'OK' &&
      energy.status === 'APPROVED' &&
      !hasSurfaceErrors(issues, 'energy', energy.exerciseKey)
    );
  }).length;

  const validTimingMappings = timingMappings.filter((timing) => {
    if (timingDuplicateKeys.has(timing.exerciseKey)) return false;
    const pinResolve = resolvePublishedPinFromSoT(
      timing.exerciseKey,
      timing.expectedPublishedRevisionNumber,
    );
    return (
      pinResolve.status === 'OK' &&
      timing.status === 'APPROVED' &&
      !hasSurfaceErrors(issues, 'timing', timing.exerciseKey)
    );
  }).length;

  const availableDuration = entries.filter((e) => e.energyDisposition === 'AVAILABLE_DURATION').length;
  const availableReps = entries.filter((e) => e.energyDisposition === 'AVAILABLE_REPS').length;
  const missingEnergy = entries.filter((e) =>
    ['MISSING_ENERGY_PROFILE', 'NO_DEFENSIBLE_MAPPING'].includes(e.energyDisposition),
  ).length;
  const missingTiming = entries.filter((e) => e.timingDisposition === 'MISSING_TIMING_PROFILE').length;
  const unsupportedMode = entries.filter(
    (e) => e.energyDisposition === 'UNSUPPORTED_REPS_OR_DURATION',
  ).length;
  const pinMismatches = entries.filter(
    (e) =>
      ['REVISION_PIN_MISMATCH', 'MISSING_REVISION_PIN', 'AMBIGUOUS_REVISION_PIN'].includes(
        e.energyDisposition,
      ) ||
      ['REVISION_PIN_MISMATCH', 'MISSING_REVISION_PIN', 'AMBIGUOUS_REVISION_PIN'].includes(
        String(e.timingDisposition),
      ),
  ).length;

  const generatorVisible = pins.filter((p) => p.enabledForGenerator).length;
  const satisfiedUnits = availableDuration + availableReps;
  const coveragePercent =
    generatorVisible === 0 ? 0 : Math.floor((satisfiedUnits / generatorVisible) * 10000) / 100;
  const fullCoverageSatisfied =
    coveragePercent >= policy.requiredCoveragePercent &&
    missingEnergy === 0 &&
    missingTiming === 0 &&
    unsupportedMode === 0 &&
    pinMismatches === 0 &&
    issues.filter((i) => i.level === 'error').length === 0;

  return {
    reportVersion: WORKOUT_ENERGY_CONTENT_REPORT_VERSION,
    generatedFromCommit: input.generatedFromCommit ?? null,
    catalogRelease: policy.catalogReleaseKey,
    policyVersion: policy.policyVersion,
    totalPins: pins.length,
    generatorVisible,
    modeCounts,
    repositoryEnergyMappings: energyMappings.length,
    repositoryTimingMappings: timingMappings.length,
    validEnergyMappings,
    validTimingMappings,
    availableDuration,
    availableReps,
    missingEnergy,
    missingTiming,
    unsupportedMode,
    pinMismatches,
    evidenceErrors: issues.filter((i) => i.level === 'error').length,
    coveragePercent,
    fullCoverageSatisfied,
    contentCoverageIncomplete: !fullCoverageSatisfied,
    workoutV2_01fStatus: 'WORKOUT-V2-01F_BLOCKED_BY_ENERGY_CONTENT',
    runtimeEnergyAfterMigrationOnly: 0,
    runtimeTimingAfterMigrationOnly: 0,
    entries,
    issues,
  };
}

export function formatCoverageConsoleSummary(report: ContentCoverageReport): string {
  return [
    '================================================================================',
    ' WORKOUT-ENERGY-CONTENT CHECK',
    '================================================================================',
    `catalogRelease=${report.catalogRelease}`,
    `policyVersion=${report.policyVersion}`,
    `totalPins=${report.totalPins}`,
    `generatorVisible=${report.generatorVisible}`,
    `modes REPS=${report.modeCounts.REPS} DURATION=${report.modeCounts.DURATION} REPS_OR_DURATION=${report.modeCounts.REPS_OR_DURATION}`,
    `repositoryEnergyMappings=${report.repositoryEnergyMappings}`,
    `repositoryTimingMappings=${report.repositoryTimingMappings}`,
    `validEnergyMappings=${report.validEnergyMappings}`,
    `validTimingMappings=${report.validTimingMappings}`,
    `availableDuration=${report.availableDuration}`,
    `availableReps=${report.availableReps}`,
    `missingEnergy=${report.missingEnergy}`,
    `missingTiming=${report.missingTiming}`,
    `unsupportedMode=${report.unsupportedMode}`,
    `pinMismatches=${report.pinMismatches}`,
    `evidenceErrors=${report.evidenceErrors}`,
    `coveragePercent=${report.coveragePercent}`,
    `fullCoverageSatisfied=${report.fullCoverageSatisfied}`,
    `runtimeAfterMigration energy/timing=${report.runtimeEnergyAfterMigrationOnly}/${report.runtimeTimingAfterMigrationOnly}`,
    report.contentCoverageIncomplete ? 'CONTENT_COVERAGE_INCOMPLETE' : 'CONTENT_COVERAGE_COMPLETE',
    report.workoutV2_01fStatus,
    '================================================================================',
  ].join('\n');
}
