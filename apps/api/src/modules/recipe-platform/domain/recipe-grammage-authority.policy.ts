import { canonicalizeUnitToken } from '../../product-catalog/domain/product-foundation.policy';

export type GrammageResolutionState =
  | 'EXACT_METRIC'
  | 'CONVERTED_WITH_AUTHORITY'
  | 'BLOCKED_MISSING_AUTHORITY'
  | 'BLOCKED_INVALID_INPUT'
  | 'EXCLUDED_OPTIONAL'
  | 'PROCESS_INPUT_TRACKED';

export type GrammageAuthority = {
  id: string;
  version: string;
  source: string;
};

export type GrammageResolution = {
  state: GrammageResolutionState;
  grams: number | null;
  normalizedUnit: string | null;
  provenance: {
    rawQuantity: number | null;
    rawUnit: string | null;
    normalizedUnit: string | null;
    coefficient: number | null;
    coefficientType: 'NONE' | 'DENSITY_G_PER_ML' | 'MASS_PER_PIECE' | 'ML_PER_TBSP' | null;
    unitCoefficient: number | null;
    unitCoefficientType: 'NONE' | 'ML_PER_TBSP' | null;
    authority: GrammageAuthority | null;
    computedGrams: number | null;
  };
  reason?: string;
};

export type GrammageInput = {
  amount: number | null | undefined;
  unit: string | null | undefined;
  rawQuantity?: number | null;
  rawUnit?: string | null;
  optional?: boolean;
  processInput?: boolean;
  density?: number | null;
  averagePieceWeightGrams?: number | null;
  authority?: GrammageAuthority | null;
};

const blocked = (input: GrammageInput, normalizedUnit: string | null, reason: string): GrammageResolution => ({
  state: 'BLOCKED_INVALID_INPUT', grams: null, normalizedUnit, reason,
  provenance: {
    rawQuantity: input.rawQuantity ?? input.amount ?? null, rawUnit: input.rawUnit ?? input.unit ?? null,
    normalizedUnit, coefficient: null, coefficientType: null, unitCoefficient: null, unitCoefficientType: null, authority: input.authority ?? null, computedGrams: null,
  },
});

/** Resolve source quantity to input grams. Every non-metric conversion is fail-closed. */
export function resolveIngredientGrams(input: GrammageInput): GrammageResolution {
  const normalizedUnit = input.unit ? canonicalizeUnitToken(input.unit) : null;
  const rawQuantity = input.rawQuantity ?? input.amount ?? null;
  const rawUnit = input.rawUnit ?? input.unit ?? null;
  const base = (state: GrammageResolutionState, grams: number | null, coefficient: number | null, coefficientType: GrammageResolution['provenance']['coefficientType'], reason?: string, unitCoefficient: number | null = null, unitCoefficientType: GrammageResolution['provenance']['unitCoefficientType'] = null): GrammageResolution => ({
    state, grams, normalizedUnit, reason,
    provenance: { rawQuantity, rawUnit, normalizedUnit, coefficient, coefficientType, unitCoefficient, unitCoefficientType, authority: input.authority ?? null, computedGrams: grams },
  });

  if (input.processInput) return base('PROCESS_INPUT_TRACKED', null, null, 'NONE');
  if (input.optional && (input.amount == null || input.unit == null)) return base('EXCLUDED_OPTIONAL', null, null, 'NONE');
  if (input.amount == null || !Number.isFinite(input.amount) || input.amount <= 0 || !normalizedUnit) return blocked(input, normalizedUnit, 'AMOUNT_OR_UNIT_INVALID');

  if (normalizedUnit === 'g' || normalizedUnit === 'kg') {
    const grams = normalizedUnit === 'kg' ? input.amount * 1000 : input.amount;
    return Number.isFinite(grams) && grams > 0 ? base('EXACT_METRIC', grams, null, 'NONE') : blocked(input, normalizedUnit, 'COMPUTED_GRAMS_INVALID');
  }

  const densityUnit = normalizedUnit === 'ml' || normalizedUnit === 'l' || normalizedUnit === 'tbsp';
  if (densityUnit) {
    const density = input.density;
    if (!isValidAuthority(input.authority) || !Number.isFinite(density) || density <= 0) return { ...blocked(input, normalizedUnit, 'DENSITY_AUTHORITY_REQUIRED'), state: 'BLOCKED_MISSING_AUTHORITY' };
    const ml = normalizedUnit === 'tbsp' ? input.amount * 15 : normalizedUnit === 'l' ? input.amount * 1000 : input.amount;
    const grams = ml * density;
    return Number.isFinite(grams) && grams > 0 ? base('CONVERTED_WITH_AUTHORITY', grams, density, 'DENSITY_G_PER_ML', undefined, normalizedUnit === 'tbsp' ? 15 : null, normalizedUnit === 'tbsp' ? 'ML_PER_TBSP' : null) : blocked(input, normalizedUnit, 'COMPUTED_GRAMS_INVALID');
  }

  if (normalizedUnit === 'piece') {
    const mass = input.averagePieceWeightGrams;
    if (!isValidAuthority(input.authority) || !Number.isFinite(mass) || mass <= 0) return { ...blocked(input, normalizedUnit, 'PIECE_WEIGHT_AUTHORITY_REQUIRED'), state: 'BLOCKED_MISSING_AUTHORITY' };
    const grams = input.amount * mass;
    return Number.isFinite(grams) && grams > 0 ? base('CONVERTED_WITH_AUTHORITY', grams, mass, 'MASS_PER_PIECE') : blocked(input, normalizedUnit, 'COMPUTED_GRAMS_INVALID');
  }

  return blocked(input, normalizedUnit, 'UNIT_UNSUPPORTED');
}

function isValidAuthority(value: GrammageAuthority | null | undefined): value is GrammageAuthority {
  return !!value && [value.id, value.version, value.source].every((part) => typeof part === 'string' && part.trim().length > 0);
}
