import type { GoalCore } from './ai-goal-core';
import type { ContextDomain } from './ai-context-selection';

export const AI_CONTEXT_DATA_VERSION = '2';

export type ContextSourceFlags = {
  profile: boolean;
  goal: boolean;
  goalCore: boolean;
  nutritionToday: boolean;
  mealPlan: boolean;
  workout: boolean;
  progress: boolean;
  shopping: boolean;
  prices: boolean;
};

export type AIConversationContextData = {
  goalCore: GoalCore;
  profile: Record<string, unknown> | null;
  goal: Record<string, unknown> | null;
  nutritionToday: Record<string, unknown> | null;
  mealPlan: Record<string, unknown> | null;
  workout: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  shopping: Record<string, unknown> | null;
  priceIntelligence: Record<string, unknown> | null;
};

/** Immutable snapshot assembled before each assistant turn. */
export type AIConversationContext = {
  userId: string;
  generatedAt: string;
  dataVersion: string;
  flags: ContextSourceFlags;
  data: AIConversationContextData;
  /** Domains packed into the prompt for this turn (set by chat pipeline). */
  selectedDomains?: ContextDomain[];
};

export type ContextUiLabels = {
  profile: boolean;
  nutrition: boolean;
  progress: boolean;
  shopping: boolean;
  prices: boolean;
};

export function toContextUiLabels(flags: ContextSourceFlags): ContextUiLabels {
  return {
    profile: flags.profile || flags.goalCore,
    nutrition: flags.nutritionToday || flags.mealPlan,
    progress: flags.progress,
    shopping: flags.shopping,
    prices: flags.prices,
  };
}

/** @deprecated use AIConversationContext */
export type AIUserContext = {
  profile: Record<string, unknown> | null;
  goal: Record<string, unknown> | null;
  mealPlan: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  shopping: Record<string, unknown> | null;
  prices: Record<string, unknown> | null;
};

export type ContextSnapshotSummary = {
  userId: string;
  generatedAt: string;
  dataVersion: string;
  flags: ContextSourceFlags;
  ui: ContextUiLabels;
};
