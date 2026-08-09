import { ingredientsForMealName } from '../../shopping-list/domain/shopping-list.catalog';
import type { RecipeCandidate } from '../../meal-plan/domain/meal-plan.types';
import type { BudgetModePreferences, OptimizeResult } from './budget-mode.types';

const MODES = new Set(['frugal', 'balanced', 'flexible']);

export function validatePreferences(input: { mode?: string }): BudgetModePreferences {
  if (!input.mode || !MODES.has(input.mode)) throw new Error('BUDGET_MODE_INVALID');
  return { mode: input.mode as BudgetModePreferences['mode'] };
}

/** Soft ranking only: callers must supply nutrition-safe candidates first. */
export function optimizeCandidates(
  candidates: RecipeCandidate[],
  excludedTags: string[],
  preferences: BudgetModePreferences,
): OptimizeResult {
  const safe = candidates.filter((candidate) => !candidate.tags?.some((tag) => excludedTags.includes(tag)));
  const priced = safe.map((candidate) => ({
    candidate,
    cost: ingredientsForMealName(candidate.name).reduce((total, ingredient) => total + ingredient.fallbackUnitPrice * ingredient.quantity / ingredient.packageSize, 0),
  }));
  const ordered =
    preferences.mode === 'flexible'
      ? [...priced].sort((a, b) => a.candidate.calories - b.candidate.calories)
      : preferences.mode === 'balanced'
        ? [...priced].sort(
            (a, b) =>
              a.cost * 0.5 + a.candidate.calories * 0.01 - (b.cost * 0.5 + b.candidate.calories * 0.01),
          )
        : [...priced].sort((a, b) => a.cost - b.cost || a.candidate.calories - b.candidate.calories);
  const baseline = priced.length ? Math.max(...priced.map((item) => item.cost)) : 0;
  const selected = ordered[0]?.cost ?? 0;
  return {
    candidates: ordered.map((item) => item.candidate),
    estimatedSavings: Math.max(0, Number((baseline - selected).toFixed(2))),
    priceConfidence: 'approximate',
    tradeoffs: [
      'Ingredient prices are approximate fallback estimates, not exact store prices.',
      preferences.mode === 'frugal'
        ? 'Cheaper estimated basket; may mean less variety and more cooking from staples.'
        : preferences.mode === 'balanced'
          ? 'Balanced cost vs variety; brand/store swaps are suggestions only.'
          : 'More flexibility and variety; lower expected savings.',
      'Safety filters (allergens/exclusions) always win over budget ranking.',
    ],
  };
}
