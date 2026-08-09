import {
  ENERGY_ACTIVE_SECONDS_MAX,
  ENERGY_ACTIVE_SECONDS_MIN,
  ENERGY_GROSS_KCAL_SANITY_CAP,
  ENERGY_INTERNAL_DECIMAL_PLACES,
  ENERGY_MET_MAX,
  ENERGY_MET_MIN,
  ENERGY_POPULATION_TYPES,
  ENERGY_WEIGHT_KG_MAX,
  ENERGY_WEIGHT_KG_MIN,
  EXERCISE_ENERGY_CALCULATION_METHODS,
  WORKOUT_ENERGY_POLICY_VERSION,
  type EnergyCalculatorInput,
  type EnergyEstimateResult,
  type EnergyEstimateUnavailable,
  type EnergyPopulationType,
  type ExerciseEnergyCalculationMethod,
} from './workout-energy.types';

/**
 * Round to fixed decimal places using half-up on absolute value.
 * Avoids binary float drift for presentation of precise kcal.
 */
export function roundEnergyDecimal(value: number, places = ENERGY_INTERNAL_DECIMAL_PLACES): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** places;
  return Math.round(value * factor + Number.EPSILON) / factor;
}

/** UI presentation boundary — not for storage of sole precise value. */
export function roundEnergyKcalForUi(preciseKcal: number): number {
  if (!Number.isFinite(preciseKcal) || preciseKcal < 0) {
    throw new Error('INVALID_CALCULATION_INPUT');
  }
  const rounded = Math.round(preciseKcal);
  return rounded === 0 && preciseKcal > 0 ? 1 : rounded;
}

function unavailable(
  status: Exclude<EnergyEstimateResult['status'], 'AVAILABLE'>,
  partial?: Partial<Omit<EnergyEstimateUnavailable, 'status'>>,
): EnergyEstimateUnavailable {
  return {
    status,
    grossEstimatedKcalPrecise: null,
    restingEstimatedKcalPrecise: null,
    incrementalEstimatedKcalPrecise: null,
    activeSecondsUsed: null,
    weightKgUsed: null,
    metValueUsed: null,
    calculationMethod: null,
    populationType: null,
    sourceVersion: null,
    policyVersion: null,
    ...partial,
  };
}

function isSupportedPopulation(value: unknown): value is EnergyPopulationType {
  return (ENERGY_POPULATION_TYPES as readonly string[]).includes(String(value));
}

function isSupportedMethod(value: unknown): value is ExerciseEnergyCalculationMethod {
  return (EXERCISE_ENERGY_CALCULATION_METHODS as readonly string[]).includes(String(value));
}

/**
 * Pure deterministic MET calculator (standard Adult Compendium MET).
 *
 * gross = MET × weightKg × hours
 * resting = 1 × weightKg × hours
 * incremental = max(0, gross − resting)  ≡ max(0, (MET−1) × weightKg × hours)
 *
 * Does not read DB/network/time. Does not round to UI integer.
 * Does not invent defaults for missing weight/MET/duration.
 */
export function estimateExerciseEnergy(input: EnergyCalculatorInput): EnergyEstimateResult {
  if (!isSupportedMethod(input.calculationMethod)) {
    return unavailable('UNSUPPORTED_CALCULATION_METHOD', {
      calculationMethod: null,
      policyVersion: input.policyVersion ?? null,
    });
  }
  if (!isSupportedPopulation(input.populationType)) {
    return unavailable('UNAVAILABLE_UNSUPPORTED_POPULATION', {
      populationType: null,
      policyVersion: input.policyVersion ?? WORKOUT_ENERGY_POLICY_VERSION,
    });
  }

  const weightKg = input.weightKg;
  const activeSeconds = input.activeSeconds;
  const metValue = input.metValue;

  if (
    typeof weightKg !== 'number' ||
    !Number.isFinite(weightKg) ||
    weightKg < ENERGY_WEIGHT_KG_MIN ||
    weightKg > ENERGY_WEIGHT_KG_MAX
  ) {
    return unavailable('INVALID_CALCULATION_INPUT', {
      weightKgUsed: null,
      policyVersion: input.policyVersion ?? null,
    });
  }

  if (
    typeof activeSeconds !== 'number' ||
    !Number.isFinite(activeSeconds) ||
    activeSeconds < ENERGY_ACTIVE_SECONDS_MIN ||
    activeSeconds > ENERGY_ACTIVE_SECONDS_MAX
  ) {
    if (
      typeof activeSeconds === 'number' &&
      Number.isFinite(activeSeconds) &&
      activeSeconds <= 0
    ) {
      return unavailable('UNAVAILABLE_MISSING_ACTIVE_DURATION', {
        activeSecondsUsed: null,
        weightKgUsed: weightKg,
        policyVersion: input.policyVersion ?? null,
      });
    }
    return unavailable('INVALID_CALCULATION_INPUT', {
      weightKgUsed: weightKg,
      policyVersion: input.policyVersion ?? null,
    });
  }

  if (
    typeof metValue !== 'number' ||
    !Number.isFinite(metValue) ||
    metValue < ENERGY_MET_MIN ||
    metValue > ENERGY_MET_MAX
  ) {
    return unavailable('INVALID_ENERGY_PROFILE', {
      weightKgUsed: weightKg,
      activeSecondsUsed: activeSeconds,
      policyVersion: input.policyVersion ?? null,
    });
  }

  if (
    typeof input.sourceVersion !== 'string' ||
    input.sourceVersion.trim().length === 0 ||
    typeof input.policyVersion !== 'string' ||
    input.policyVersion.trim().length === 0
  ) {
    return unavailable('INVALID_ENERGY_PROFILE', {
      weightKgUsed: weightKg,
      activeSecondsUsed: activeSeconds,
      metValueUsed: metValue,
    });
  }

  const activeHours = activeSeconds / 3600;
  const gross = metValue * weightKg * activeHours;
  const resting = 1 * weightKg * activeHours;
  const incremental = Math.max(0, gross - resting);

  if (
    !Number.isFinite(gross) ||
    !Number.isFinite(resting) ||
    !Number.isFinite(incremental) ||
    gross < 0 ||
    resting < 0 ||
    incremental < 0
  ) {
    return unavailable('INVALID_CALCULATION_INPUT', {
      weightKgUsed: weightKg,
      activeSecondsUsed: activeSeconds,
      metValueUsed: metValue,
      policyVersion: input.policyVersion,
      sourceVersion: input.sourceVersion,
      calculationMethod: input.calculationMethod,
      populationType: input.populationType,
    });
  }

  if (gross > ENERGY_GROSS_KCAL_SANITY_CAP) {
    return unavailable('INVALID_CALCULATION_INPUT', {
      weightKgUsed: weightKg,
      activeSecondsUsed: activeSeconds,
      metValueUsed: metValue,
      policyVersion: input.policyVersion,
      sourceVersion: input.sourceVersion,
      calculationMethod: input.calculationMethod,
      populationType: input.populationType,
    });
  }

  return {
    status: 'AVAILABLE',
    grossEstimatedKcalPrecise: roundEnergyDecimal(gross),
    restingEstimatedKcalPrecise: roundEnergyDecimal(resting),
    incrementalEstimatedKcalPrecise: roundEnergyDecimal(incremental),
    activeSecondsUsed: activeSeconds,
    weightKgUsed: weightKg,
    metValueUsed: metValue,
    calculationMethod: input.calculationMethod,
    populationType: input.populationType,
    sourceVersion: input.sourceVersion,
    policyVersion: input.policyVersion,
  };
}
