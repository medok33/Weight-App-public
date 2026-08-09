import {
  ENERGY_WEIGHT_KG_MAX,
  ENERGY_WEIGHT_KG_MIN,
  type ResolveWeightResult,
} from './workout-energy.types';

export type WeightResolverProgressRow = {
  id?: string;
  userId: string;
  weightKg: number;
  measuredAt: string;
  createdAt?: string | null;
};

export type { ResolveWeightResult };

export type WeightResolverProfile = {
  userId: string;
  weightKg: number;
};

function isValidWeight(weightKg: number): boolean {
  return Number.isFinite(weightKg) && weightKg >= ENERGY_WEIGHT_KG_MIN && weightKg <= ENERGY_WEIGHT_KG_MAX;
}

function parseInstant(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Deterministic ordering for measurements at identical measuredAt:
 * later createdAt wins; then larger id (lexicographic UUID) wins.
 */
export function compareProgressForEnergy(
  a: WeightResolverProgressRow,
  b: WeightResolverProgressRow,
): number {
  const aMs = parseInstant(a.measuredAt);
  const bMs = parseInstant(b.measuredAt);
  if (aMs !== bMs) return aMs - bMs;
  const aCreated = a.createdAt ? parseInstant(a.createdAt) : 0;
  const bCreated = b.createdAt ? parseInstant(b.createdAt) : 0;
  if (aCreated !== bCreated) return aCreated - bCreated;
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

/**
 * Trusted server-side weight resolver for workout energy.
 * Precedence: latest valid ProgressEntry at/before asOf → profile fallback → unavailable.
 * Never uses target/forecast/other-user/default weight.
 */
export function resolveWorkoutEnergyWeight(input: {
  userId: string;
  asOf: string;
  progressEntries: WeightResolverProgressRow[];
  profile: WeightResolverProfile | null;
}): ResolveWeightResult {
  const asOf = input.asOf;
  const asOfMs = parseInstant(asOf);
  if (!input.userId || !Number.isFinite(asOfMs)) {
    return {
      status: 'UNAVAILABLE_MISSING_WEIGHT',
      weightKg: null,
      source: null,
      sourceRecordedAt: null,
      asOf,
    };
  }

  const owned = input.progressEntries.filter((row) => row.userId === input.userId);
  const eligible = owned
    .filter((row) => {
      const measuredMs = parseInstant(row.measuredAt);
      return Number.isFinite(measuredMs) && measuredMs <= asOfMs && isValidWeight(row.weightKg);
    })
    .sort(compareProgressForEnergy);

  const latest = eligible.length > 0 ? eligible[eligible.length - 1]! : null;
  if (latest) {
    return {
      status: 'AVAILABLE',
      weightKg: latest.weightKg,
      source: 'PROGRESS_MEASUREMENT',
      sourceRecordedAt: latest.measuredAt,
      asOf,
    };
  }

  if (
    input.profile &&
    input.profile.userId === input.userId &&
    isValidWeight(input.profile.weightKg)
  ) {
    return {
      status: 'AVAILABLE',
      weightKg: input.profile.weightKg,
      source: 'PROFILE_FALLBACK',
      sourceRecordedAt: null,
      asOf,
    };
  }

  return {
    status: 'UNAVAILABLE_MISSING_WEIGHT',
    weightKg: null,
    source: null,
    sourceRecordedAt: null,
    asOf,
  };
}
