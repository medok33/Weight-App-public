import {
  ENERGY_ACTIVE_SECONDS_MAX,
  ENERGY_SECONDS_PER_REP_MAX,
  ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE,
} from './workout-energy.types';
import type { PrescriptionMode } from './workout-plan-prescription';

export type PlannedSetTarget = {
  targetReps: number | null;
  targetDurationSeconds: number | null;
};

export type ActiveSecondsResult =
  | { status: 'AVAILABLE'; activeSeconds: number }
  | {
      status: 'UNAVAILABLE_MISSING_ACTIVE_DURATION' | 'INVALID_PLAN_PRESCRIPTION';
      activeSeconds: null;
    };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function deriveActiveSecondsFromTargets(input: {
  prescriptionMode: PrescriptionMode | null;
  setTargets: PlannedSetTarget[];
  secondsPerRep?: number | null;
}): ActiveSecondsResult {
  if (input.prescriptionMode == null) {
    return { status: 'INVALID_PLAN_PRESCRIPTION', activeSeconds: null };
  }
  if (input.setTargets.length === 0) {
    return { status: 'UNAVAILABLE_MISSING_ACTIVE_DURATION', activeSeconds: null };
  }

  if (input.prescriptionMode === 'DURATION') {
    if (
      input.setTargets.some(
        (target) => target.targetReps != null || !isPositiveInteger(target.targetDurationSeconds),
      )
    ) {
      return { status: 'INVALID_PLAN_PRESCRIPTION', activeSeconds: null };
    }
    const activeSeconds = input.setTargets.reduce(
      (sum, target) => sum + target.targetDurationSeconds!,
      0,
    );
    if (activeSeconds > ENERGY_ACTIVE_SECONDS_MAX) {
      return { status: 'INVALID_PLAN_PRESCRIPTION', activeSeconds: null };
    }
    return { status: 'AVAILABLE', activeSeconds };
  }

  if (
    input.setTargets.some(
      (target) => target.targetDurationSeconds != null || !isPositiveInteger(target.targetReps),
    )
  ) {
    return { status: 'INVALID_PLAN_PRESCRIPTION', activeSeconds: null };
  }
  const secondsPerRep = input.secondsPerRep;
  if (secondsPerRep == null) {
    return { status: 'UNAVAILABLE_MISSING_ACTIVE_DURATION', activeSeconds: null };
  }
  if (
    typeof secondsPerRep !== 'number' ||
    !Number.isFinite(secondsPerRep) ||
    secondsPerRep <= ENERGY_SECONDS_PER_REP_MIN_EXCLUSIVE ||
    secondsPerRep > ENERGY_SECONDS_PER_REP_MAX
  ) {
    return { status: 'INVALID_PLAN_PRESCRIPTION', activeSeconds: null };
  }

  const activeSeconds =
    input.setTargets.reduce((sum, target) => sum + target.targetReps!, 0) * secondsPerRep;
  if (
    !Number.isFinite(activeSeconds) ||
    activeSeconds <= 0 ||
    activeSeconds > ENERGY_ACTIVE_SECONDS_MAX
  ) {
    return { status: 'INVALID_PLAN_PRESCRIPTION', activeSeconds: null };
  }
  return { status: 'AVAILABLE', activeSeconds };
}
