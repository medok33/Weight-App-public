import { hashCanonical } from './workout-adaptation.fingerprint';
import {
  ALGORITHM_VERSION,
  filterCatalog,
  generateWeeklyPlan,
} from './workout-plan-generator';
import type {
  CatalogExercise,
  TrainingPlace,
  WorkoutPlanDetail,
  WorkoutPlanGenerateInput,
} from './workout-engine.types';

/**
 * WORKOUT-01A boundary. Bump when the effective generator request or decision
 * semantics change; this is deliberately independent from deployment identity.
 */
export const GENERATOR_CONTRACT_VERSION = 'workout-generator-pilot-01a.2';

export type GeneratorRequestKind = 'NEW_WEEKLY' | 'HOME_SHORT_REPLACEMENT';
export type GeneratorResultStatus = 'SUCCESS' | 'NO_VIABLE_CANDIDATE' | 'INSUFFICIENT_INPUT';
export type GeneratorReasonCode =
  | 'WORKOUT_SETUP_INCOMPLETE'
  | 'NO_ELIGIBLE_EXERCISES'
  | 'INSUFFICIENT_ELIGIBLE_EXERCISES';

export type GeneratorCatalogReleaseRef = {
  id: string;
  code: string;
  manifestVersion: string;
};

export type WorkoutGeneratorPilotInput = WorkoutPlanGenerateInput & {
  requestKind?: GeneratorRequestKind;
};

export type HomeShortReplacementContext = {
  sourceWorkoutPlanId: string;
  sourcePlanVersion: number;
  originalExerciseKeys: string[];
};

export type GeneratorFilterSummary = {
  catalogCandidates: number;
  hardExcluded: number;
  levelIncompatible: number;
  equipmentIncompatible: number;
  inactive: number;
  eligible: number;
};

export type SelectedExerciseEvidence = {
  exerciseKey: string;
  exerciseId: string | null;
  exerciseRevisionId: string | null;
  movementPattern: string;
  evidence: readonly [
    'PUBLISHED_IN_RELEASE',
    'EQUIPMENT_COMPATIBLE',
    'LEVEL_COMPATIBLE',
    'NOT_HARD_EXCLUDED',
  ];
};

/** Bounded, immutable decision evidence persisted with the generated plan. */
export type WorkoutGeneratorDecisionTrace = {
  traceId: string;
  decisionFingerprint: string;
  generatorContractVersion: typeof GENERATOR_CONTRACT_VERSION;
  generatorVersion: string;
  catalogRelease: GeneratorCatalogReleaseRef;
  requestKind: GeneratorRequestKind;
  inputFingerprint: string;
  appliedHardConstraints: {
    trainingPlace: TrainingPlace;
    trainingLevel: WorkoutPlanGenerateInput['trainingLevel'];
    equipmentCodes: string[];
    excludedKeys: string[];
  };
  replacement?: HomeShortReplacementContext;
  filterSummary: GeneratorFilterSummary;
  selectedExercises: SelectedExerciseEvidence[];
  resultStatus: GeneratorResultStatus;
  reasonCodes: GeneratorReasonCode[];
};

export type WorkoutGeneratorPilotResult =
  | {
      status: 'SUCCESS';
      plan: WorkoutPlanDetail;
      trace: WorkoutGeneratorDecisionTrace;
    }
  | {
      status: 'NO_VIABLE_CANDIDATE' | 'INSUFFICIENT_INPUT';
      plan: null;
      trace: WorkoutGeneratorDecisionTrace;
    };

function normalizeStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))].sort();
}

function normalizeInput(input: WorkoutGeneratorPilotInput): WorkoutPlanGenerateInput {
  return {
    ...input,
    equipmentCodes: normalizeStrings(input.equipmentCodes),
    excludedKeys: normalizeStrings(input.excludedKeys),
    availableDays: [...new Set((input.availableDays ?? []).filter(Number.isInteger))].sort((a, b) => a - b),
    preferredActivityTypes: normalizeStrings(input.preferredActivityTypes),
  };
}

function isSetupComplete(input: WorkoutPlanGenerateInput): boolean {
  return Boolean(input.goalKind?.trim() && input.trainingLevel && input.workoutsPerWeek);
}

function filterSummary(catalog: CatalogExercise[], input: WorkoutPlanGenerateInput): GeneratorFilterSummary {
  const eligible = filterCatalog(catalog, input);
  const excluded = new Set(input.excludedKeys);
  const active = catalog.filter((item) => item.isActive !== false);
  const notExcluded = active.filter((item) => !excluded.has(item.key));
  const levelEligible = notExcluded.filter((item) => {
    const rank = { BEGINNER: 1, INTERMEDIATE: 2, ADVANCED: 3 } as const;
    return rank[item.difficulty] <= rank[input.trainingLevel];
  });
  return {
    catalogCandidates: catalog.length,
    inactive: catalog.length - active.length,
    hardExcluded: active.length - notExcluded.length,
    levelIncompatible: notExcluded.length - levelEligible.length,
    equipmentIncompatible: levelEligible.length - eligible.length,
    eligible: eligible.length,
  };
}

function traceFor(input: {
  catalog: CatalogExercise[];
  request: WorkoutPlanGenerateInput;
  release: GeneratorCatalogReleaseRef;
  status: GeneratorResultStatus;
  reasonCodes: GeneratorReasonCode[];
  plan: WorkoutPlanDetail | null;
  requestKind?: GeneratorRequestKind;
  replacement?: HomeShortReplacementContext;
  selectedCatalogExercises?: CatalogExercise[];
}): WorkoutGeneratorDecisionTrace {
  const normalized = normalizeInput(input.request);
  const summary = filterSummary(input.catalog, normalized);
  const inputFingerprint = hashCanonical({
    generatorContractVersion: GENERATOR_CONTRACT_VERSION as typeof GENERATOR_CONTRACT_VERSION,
    generatorVersion: ALGORITHM_VERSION,
    catalogReleaseId: input.release.id,
    request: normalized,
  });
  const selectedExercises = (input.selectedCatalogExercises ?? (input.plan?.days ?? [])
    .flatMap((day) => day.exercises)
    .filter((exercise) => exercise.exerciseKey && exercise.exerciseKey !== 'rest')
    .map((exercise) => {
      const catalogExercise = input.catalog.find((item) => item.key === exercise.exerciseKey);
      return {
        exerciseKey: exercise.exerciseKey!,
        exerciseId: exercise.exerciseId ?? catalogExercise?.id ?? null,
        exerciseRevisionId: catalogExercise?.exerciseRevisionId ?? null,
        movementPattern: catalogExercise?.movementPattern ?? 'unknown',
        evidence: [
          'PUBLISHED_IN_RELEASE',
          'EQUIPMENT_COMPATIBLE',
          'LEVEL_COMPATIBLE',
          'NOT_HARD_EXCLUDED',
        ],
      } as SelectedExerciseEvidence;
    }))
    .map((exercise) => {
      if ('exerciseKey' in exercise && 'evidence' in exercise) return exercise as SelectedExerciseEvidence;
      const catalogExercise = exercise as CatalogExercise;
      return {
        exerciseKey: catalogExercise.key,
        exerciseId: catalogExercise.id ?? null,
        exerciseRevisionId: catalogExercise.exerciseRevisionId ?? null,
        movementPattern: catalogExercise.movementPattern,
        evidence: ['PUBLISHED_IN_RELEASE', 'EQUIPMENT_COMPATIBLE', 'LEVEL_COMPATIBLE', 'NOT_HARD_EXCLUDED'],
      } as SelectedExerciseEvidence;
    });
  const decision = {
    generatorContractVersion: GENERATOR_CONTRACT_VERSION as typeof GENERATOR_CONTRACT_VERSION,
    generatorVersion: ALGORITHM_VERSION,
    catalogRelease: input.release,
    requestKind: input.requestKind ?? 'NEW_WEEKLY',
    inputFingerprint,
    appliedHardConstraints: {
      trainingPlace: normalized.trainingPlace ?? 'HOME',
      trainingLevel: normalized.trainingLevel,
      equipmentCodes: normalized.equipmentCodes,
      excludedKeys: normalized.excludedKeys,
    },
    filterSummary: summary,
    replacement: input.replacement,
    selectedExercises,
    resultStatus: input.status,
    reasonCodes: [...input.reasonCodes].sort(),
  };
  const decisionFingerprint = hashCanonical(decision);
  return {
    traceId: `wgt_${decisionFingerprint}`,
    decisionFingerprint,
    ...decision,
  };
}

/** Shared, bounded selector for the existing HOME_SHORT replacement rule. */
export function selectHomeShortReplacementForPilot(
  catalog: CatalogExercise[],
  input: WorkoutGeneratorPilotInput,
  release: GeneratorCatalogReleaseRef,
  replacement: HomeShortReplacementContext,
): { status: 'SUCCESS'; exercises: CatalogExercise[]; trace: WorkoutGeneratorDecisionTrace } | {
  status: 'NO_VIABLE_CANDIDATE'; exercises: []; trace: WorkoutGeneratorDecisionTrace;
} {
  const request = normalizeInput({ ...input, trainingPlace: 'HOME' });
  // Replacing a day must produce genuinely different exercises.  Apply this
  // as a hard constraint before the deterministic bounded selection rather
  // than dropping candidates after a top-three choice was made.
  const originalKeys = new Set(normalizeStrings(replacement.originalExerciseKeys));
  const exercises = filterCatalog(catalog, request)
    .filter((exercise) => !originalKeys.has(exercise.key))
    .slice(0, 3);
  if (exercises.length < 3) {
    return {
      status: 'NO_VIABLE_CANDIDATE',
      exercises: [],
      trace: traceFor({
        catalog, request, release, replacement, requestKind: 'HOME_SHORT_REPLACEMENT',
        status: 'NO_VIABLE_CANDIDATE',
        reasonCodes: [exercises.length === 0 ? 'NO_ELIGIBLE_EXERCISES' : 'INSUFFICIENT_ELIGIBLE_EXERCISES'],
        plan: null,
      }),
    };
  }
  return {
    status: 'SUCCESS', exercises,
    trace: traceFor({
      catalog, request, release, replacement, requestKind: 'HOME_SHORT_REPLACEMENT',
      status: 'SUCCESS', reasonCodes: [], plan: null, selectedCatalogExercises: exercises,
    }),
  };
}

/**
 * Typed, fail-closed facade over the existing deterministic weekly generator.
 * The supplied catalog is already the explicit published release pin set.
 */
export function generateWeeklyPlanForPilot(
  catalog: CatalogExercise[],
  input: WorkoutGeneratorPilotInput,
  release: GeneratorCatalogReleaseRef,
): WorkoutGeneratorPilotResult {
  const request = normalizeInput(input);
  if (!isSetupComplete(request)) {
    return {
      status: 'INSUFFICIENT_INPUT',
      plan: null,
      trace: traceFor({
        catalog,
        request,
        release,
        status: 'INSUFFICIENT_INPUT',
        reasonCodes: ['WORKOUT_SETUP_INCOMPLETE'],
        plan: null,
      }),
    };
  }

  try {
    const plan = generateWeeklyPlan(catalog, request);
    return {
      status: 'SUCCESS',
      plan,
      trace: traceFor({ catalog, request, release, status: 'SUCCESS', reasonCodes: [], plan }),
    };
  } catch (error) {
    if ((error as Error).message !== 'WORKOUT_CATALOG_INSUFFICIENT') throw error;
    const summary = filterSummary(catalog, request);
    return {
      status: 'NO_VIABLE_CANDIDATE',
      plan: null,
      trace: traceFor({
        catalog,
        request,
        release,
        status: 'NO_VIABLE_CANDIDATE',
        reasonCodes: [summary.eligible === 0 ? 'NO_ELIGIBLE_EXERCISES' : 'INSUFFICIENT_ELIGIBLE_EXERCISES'],
        plan: null,
      }),
    };
  }
}
