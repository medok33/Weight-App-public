import type { CalculationExplanation, DeficitMode, NutritionProfile, NutritionResult } from './nutrition-engine.types';
export const NUTRITION_POLICY_VERSION = 'nutrition-1.0';
export function calculateBmr(profile: Omit<NutritionProfile, 'activityFactor'>): number {
  if (![profile.weightKg, profile.heightCm, profile.ageYears].every(Number.isFinite) || profile.weightKg <= 0 || profile.heightCm <= 0 || profile.ageYears <= 0) throw new Error('NUTRITION_INVALID_PROFILE');
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears;
  return Math.round(profile.sex === 'male' ? base + 5 : base - 161);
}
export function calculateTdee(profile: NutritionProfile): NutritionResult {
  if (!Number.isFinite(profile.activityFactor) || profile.activityFactor < 1.2 || profile.activityFactor > 2.5) throw new Error('NUTRITION_INVALID_ACTIVITY_FACTOR');
  return { bmrKcal: calculateBmr(profile), tdeeKcal: Math.round(calculateBmr(profile) * profile.activityFactor), policyVersion: NUTRITION_POLICY_VERSION };
}

export function calorieTarget(tdeeKcal: number, mode: DeficitMode, sex: 'female' | 'male'): number {
  if (!Number.isFinite(tdeeKcal) || tdeeKcal <= 0) throw new Error('NUTRITION_INVALID_TDEE');
  const deficit = { conservative: 0.1, standard: 0.15, aggressive: 0.2 }[mode];
  const floor = sex === 'female' ? 1200 : 1500;
  return Math.max(floor, Math.round(tdeeKcal * (1 - deficit)));
}

export function proteinTarget(referenceWeightKg: number, activityFactor: number): number {
  if (!Number.isFinite(referenceWeightKg) || referenceWeightKg <= 0) throw new Error('NUTRITION_INVALID_REFERENCE_WEIGHT');
  const gramsPerKg = activityFactor >= 1.6 ? 1.6 : 1.2;
  return Math.round(referenceWeightKg * gramsPerKg);
}

export function targetEtaWeeks(currentWeightKg: number, targetWeightKg: number, paceKgPerWeek = 0.5): number {
  if (currentWeightKg <= targetWeightKg || paceKgPerWeek <= 0) throw new Error('NUTRITION_INVALID_TARGET');
  return Math.ceil((currentWeightKg - targetWeightKg) / paceKgPerWeek);
}

export function explainCalculation(result: NutritionResult, targetKcal: number): CalculationExplanation {
  return [
    { label: 'BMR', value: result.bmrKcal, rationale: 'Estimated resting energy need from the deterministic formula.' },
    { label: 'TDEE', value: result.tdeeKcal, rationale: 'BMR adjusted by the selected activity factor.' },
    { label: 'Daily target', value: targetKcal, rationale: 'Target is bounded by the product calorie floor.' },
  ];
}
