import type { RecipeCandidate } from '../../meal-plan/domain/meal-plan.types';

export type BudgetModePreference = 'frugal' | 'balanced' | 'flexible';
export type BudgetModePreferences = { mode: BudgetModePreference };
export type OptimizeInput = { candidates: RecipeCandidate[]; excludedTags?: string[] };
export type PriceConfidence = 'high' | 'approximate';
export type OptimizeResult = {
  candidates: RecipeCandidate[];
  tradeoffs: string[];
  estimatedSavings: number;
  priceConfidence: PriceConfidence;
};
