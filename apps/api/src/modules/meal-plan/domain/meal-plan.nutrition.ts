import { activityFactor } from '../../user-profile/domain/user-profile.policy';
import type { UserGoalRecord, UserProfileRecord } from '../../user-profile/domain/user-profile.types';
import { calculateTdee, calorieTarget, proteinTarget } from '../../nutrition-engine/domain/nutrition-engine.policy';

export type NutritionTargets = {
  targetKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tdeeKcal: number;
  bmrKcal: number;
};

/** Sex is not collected in MVP onboarding yet; male floor (1500) is the safer default for calorie targets. */
const DEFAULT_SEX = 'male' as const;

export function resolveNutritionTargets(
  profile: UserProfileRecord | null,
  goal: UserGoalRecord | null,
): NutritionTargets | null {
  if (!profile) return null;
  const factor = activityFactor(profile.activityLevel);
  const result = calculateTdee({
    sex: DEFAULT_SEX,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    ageYears: profile.ageYears,
    activityFactor: factor,
  });

  let targetKcal = result.tdeeKcal;
  if (goal?.kind === 'lose_weight') {
    targetKcal = calorieTarget(result.tdeeKcal, 'standard', DEFAULT_SEX);
  } else if (goal?.kind === 'gain_muscle') {
    targetKcal = Math.round(result.tdeeKcal * 1.1);
  }

  return {
    targetKcal,
    proteinG: proteinTarget(profile.weightKg, factor),
    fatG: Math.round((targetKcal * 0.3) / 9),
    carbsG: Math.max(0, Math.round((targetKcal - proteinTarget(profile.weightKg, factor) * 4 - Math.round((targetKcal * 0.3) / 9) * 9) / 4)),
    tdeeKcal: result.tdeeKcal,
    bmrKcal: result.bmrKcal,
  };
}
