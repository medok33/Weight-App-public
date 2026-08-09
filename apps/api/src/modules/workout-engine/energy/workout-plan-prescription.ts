export type PrescriptionMode = 'REPS' | 'DURATION';
export type RevisionRepetitionMode = PrescriptionMode | 'REPS_OR_DURATION';

type PrescriptionInput = {
  revisionRepetitionMode?: RevisionRepetitionMode | null;
  /** Catalog defaultSets. For DURATION, only 1 is supported (whole-exercise interval). */
  revisionDefaultSets?: number | null;
  defaultDurationSeconds?: number | null;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
};

export type PlanExercisePrescription = {
  kind: 'SUPPORTED' | 'UNSUPPORTED';
  prescriptionMode: PrescriptionMode | null;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  restSeconds: number;
  durationSecondsPerSet: number | null;
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function assertBasePrescription(input: PrescriptionInput): void {
  if (
    !isPositiveInteger(input.sets) ||
    !isPositiveInteger(input.repsMin) ||
    !isPositiveInteger(input.repsMax) ||
    input.repsMax < input.repsMin ||
    !Number.isInteger(input.restSeconds) ||
    input.restSeconds < 0
  ) {
    throw new Error('INVALID_PLAN_PRESCRIPTION');
  }
}

/**
 * Exact planned reps for energy/session/UI — matches WorkoutSessionSet seeding.
 * Catalog/default ranges remain on the plan row; USER-facing active target is exact.
 */
export function exactTargetReps(repsMin: number | null, repsMax: number | null): number | null {
  if (repsMax != null && Number.isInteger(repsMax) && repsMax > 0) return repsMax;
  if (repsMin != null && Number.isInteger(repsMin) && repsMin > 0) return repsMin;
  return null;
}

/**
 * Converts the catalog-authored repetition mode into one coherent plan
 * prescription. Ambiguous/legacy modes retain reps for UX continuity but are
 * explicitly unsupported for energy derivation.
 *
 * DURATION semantics (01B-FIX-01):
 * current catalog stores whole-exercise duration with defaultSets=1.
 * Generated volume `rx.sets` must NOT multiply that interval.
 * Multi-set DURATION (defaultSets != 1) is fail-closed until an explicit
 * per-set duration model exists.
 */
export function buildPlanExercisePrescription(input: PrescriptionInput): PlanExercisePrescription {
  assertBasePrescription(input);

  if (input.revisionRepetitionMode === 'REPS') {
    if (input.defaultDurationSeconds != null) {
      throw new Error('INVALID_PLAN_PRESCRIPTION');
    }
    return {
      kind: 'SUPPORTED',
      prescriptionMode: 'REPS',
      sets: input.sets,
      repsMin: input.repsMin,
      repsMax: input.repsMax,
      restSeconds: input.restSeconds,
      durationSecondsPerSet: null,
    };
  }

  if (input.revisionRepetitionMode === 'DURATION') {
    const duration = input.defaultDurationSeconds;
    if (duration == null || !isPositiveInteger(duration)) {
      throw new Error('INVALID_PLAN_PRESCRIPTION');
    }
    if (input.revisionDefaultSets != null && input.revisionDefaultSets !== 1) {
      throw new Error('UNSUPPORTED_DURATION_SET_SEMANTICS');
    }
    return {
      kind: 'SUPPORTED',
      prescriptionMode: 'DURATION',
      sets: 1,
      repsMin: null,
      repsMax: null,
      restSeconds: input.restSeconds,
      durationSecondsPerSet: duration,
    };
  }

  return {
    kind: 'UNSUPPORTED',
    prescriptionMode: null,
    sets: input.sets,
    repsMin: input.repsMin,
    repsMax: input.repsMax,
    restSeconds: input.restSeconds,
    durationSecondsPerSet: null,
  };
}
