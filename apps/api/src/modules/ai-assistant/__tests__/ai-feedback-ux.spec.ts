import { describe, expect, it } from 'vitest';
import { toContextUiLabels } from '../domain/ai-conversation-context.types';

describe('toContextUiLabels', () => {
  it('exposes shopping and prices separately', () => {
    const ui = toContextUiLabels({
      goalCore: true,
      profile: true,
      goal: false,
      nutritionToday: true,
      mealPlan: false,
      workout: false,
      progress: true,
      shopping: true,
      prices: false,
    });
    expect(ui).toEqual({
      profile: true,
      nutrition: true,
      progress: true,
      shopping: true,
      prices: false,
    });
  });
});
