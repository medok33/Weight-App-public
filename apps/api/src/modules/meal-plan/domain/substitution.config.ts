import type { CompensationOption, SubstitutionClassification } from './substitution.types';

/** Ranking weights — deterministic, no random. Higher = more important when scoring (lower score wins). */
export const SUBSTITUTION_RANK_WEIGHTS = {
  calorieDeviation: Number(process.env.SUB_RANK_CALORIE ?? '4'),
  proteinDeviation: Number(process.env.SUB_RANK_PROTEIN ?? '3'),
  fatDeviation: Number(process.env.SUB_RANK_FAT ?? '1.5'),
  carbsDeviation: Number(process.env.SUB_RANK_CARBS ?? '1.5'),
  portionDeviation: Number(process.env.SUB_RANK_PORTION ?? '1'),
  costDeviation: Number(process.env.SUB_RANK_COST ?? '1'),
  prepTimeDeviation: Number(process.env.SUB_RANK_PREP ?? '0.5'),
  preferenceMatch: Number(process.env.SUB_RANK_PREF ?? '2'),
  rejectedPenalty: Number(process.env.SUB_RANK_REJECTED ?? '5'),
  dayCompatibility: Number(process.env.SUB_RANK_DAY ?? '1'),
} as const;

/** Classification thresholds as ratios of original macros (config, not UI hardcode). */
export const SUBSTITUTION_CLASS_THRESHOLDS = {
  equivalentMaxCaloriePct: Number(process.env.SUB_EQ_CAL_PCT ?? '0.08'),
  equivalentMaxProteinPct: Number(process.env.SUB_EQ_PRO_PCT ?? '0.12'),
  equivalentMaxMacroPct: Number(process.env.SUB_EQ_MACRO_PCT ?? '0.15'),
  adjustableMaxCaloriePct: Number(process.env.SUB_ADJ_CAL_PCT ?? '0.2'),
  adjustableMaxProteinPct: Number(process.env.SUB_ADJ_PRO_PCT ?? '0.25'),
  conflictingMinCaloriePct: Number(process.env.SUB_CON_CAL_PCT ?? '0.2'),
} as const;

export const SUBSTITUTION_PORTION = {
  minGrams: Number(process.env.SUB_PORTION_MIN_G ?? '40'),
  maxGrams: Number(process.env.SUB_PORTION_MAX_G ?? '900'),
  minScale: Number(process.env.SUB_PORTION_MIN_SCALE ?? '0.4'),
  maxScale: Number(process.env.SUB_PORTION_MAX_SCALE ?? '2.5'),
} as const;

export const COMPENSATION_BY_CLASS: Record<SubstitutionClassification, CompensationOption[]> = {
  EQUIVALENT: [],
  ADJUSTABLE: ['REDUCE_PORTION', 'ADJUST_NEXT_MEAL', 'REPLACE_SNACK', 'ACCEPT_FORECAST_SHIFT', 'OPTIONAL_WALK'],
  CONFLICTING: ['REDUCE_PORTION', 'ADJUST_NEXT_MEAL', 'REPLACE_SNACK', 'ACCEPT_FORECAST_SHIFT', 'OPTIONAL_WALK'],
  BLOCKED: [],
};
