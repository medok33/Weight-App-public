import { SUBSTITUTION_RANK_WEIGHTS } from './substitution.config';
import type { SubstitutionCandidate, UserDietConstraints } from './substitution.types';

function preferenceBonus(tags: string[], constraints: UserDietConstraints): number {
  const prefs = new Set(constraints.dietaryPreferences.map((p) => p.toLowerCase()));
  if (!prefs.size) return 0;
  return tags.some((t) => prefs.has(t.toLowerCase())) ? 0 : 1;
}

function rejectedPenalty(productIds: string[], constraints: UserDietConstraints): number {
  return productIds.some((id) => constraints.rejectedProductIds.includes(id)) ? 1 : 0;
}

/**
 * Lower score is better. Stable sort by score then candidateId.
 */
export function rankScore(input: {
  candidate: Pick<
    SubstitutionCandidate,
    'candidateId' | 'nutrientDelta' | 'suggestedPortionGrams' | 'originalPortionGrams' | 'costDeltaRub' | 'preparationMinutes' | 'dietaryTags'
  >;
  sourcePrepMinutes: number;
  ingredientProductIds: string[];
  constraints: UserDietConstraints;
  dayCalorieGapAfter: number;
}): number {
  const w = SUBSTITUTION_RANK_WEIGHTS;
  const d = input.candidate.nutrientDelta;
  const portionDev =
    Math.abs(input.candidate.suggestedPortionGrams - input.candidate.originalPortionGrams) /
    Math.max(input.candidate.originalPortionGrams, 1);
  const costDev = Math.abs(input.candidate.costDeltaRub ?? 0) / 100;
  const prepDev = Math.abs(input.candidate.preparationMinutes - input.sourcePrepMinutes) / 30;
  const pref = preferenceBonus(input.candidate.dietaryTags, input.constraints);
  const rejected = rejectedPenalty(input.ingredientProductIds, input.constraints);
  const dayCompat = Math.abs(input.dayCalorieGapAfter) / 500;

  return (
    w.calorieDeviation * Math.abs(d.caloriesPct) / 100 +
    w.proteinDeviation * Math.abs(d.proteinPct) / 100 +
    w.fatDeviation * Math.abs(d.fatPct) / 100 +
    w.carbsDeviation * Math.abs(d.carbsPct) / 100 +
    w.portionDeviation * portionDev +
    w.costDeviation * costDev +
    w.prepTimeDeviation * prepDev +
    w.preferenceMatch * pref +
    w.rejectedPenalty * rejected +
    w.dayCompatibility * dayCompat
  );
}

export function sortCandidatesStable<T extends { candidateId: string }>(
  items: T[],
  scoreOf: (item: T) => number,
): T[] {
  return [...items]
    .map((item, index) => ({ item, score: scoreOf(item), index }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.item.candidateId < b.item.candidateId) return -1;
      if (a.item.candidateId > b.item.candidateId) return 1;
      return a.index - b.index;
    })
    .map((row) => row.item);
}
