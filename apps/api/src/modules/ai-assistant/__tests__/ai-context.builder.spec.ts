import { describe, expect, it, vi } from 'vitest';
import { AIContextBuilder } from '../application/ai-context.builder';
import { buildSystemPrompt } from '../domain/ai-context.prompt';
import { AI_CONTEXT_DATA_VERSION } from '../domain/ai-conversation-context.types';

describe('AI context pipeline', () => {
  it('builds snapshot with version and flags', async () => {
    const builder = new AIContextBuilder(
      {
        getProfile: vi.fn(async () => ({ ageYears: 30, heightCm: 175, weightKg: 80, activityLevel: 'moderate', locale: 'ru' })),
        getGoal: vi.fn(async () => ({ kind: 'lose_weight', target: 75, unit: 'kg' })),
      } as never,
      { getSummary: vi.fn(async () => ({ personalized: true, targetKcal: 1800, proteinG: 120, days: [{ dayIndex: 0, mealName: 'oatmeal_bowl', calories: 320, proteinG: 12, completed: false }] })) } as never,
      { getToday: vi.fn(async () => ({ localDate: '2026-07-21', plannedKcal: 1800, consumedKcal: 900, remainingKcal: 900, proteinConsumed: 60, proteinTarget: 120, completedMealIds: [] })) } as never,
      { getSummary: vi.fn(async () => ({ version: 1, days: [{ dayIndex: 0, exerciseName: 'morning_walk' }] })) } as never,
      { summary: vi.fn(async () => ({ deltaKg: -1.2, latest: { weightKg: 79 }, entries: [{ weightKg: 80 }, { weightKg: 79 }] })) } as never,
      { getLatest: vi.fn(async () => ({ items: [{ name: 'oats', estimatedCost: 95 }], estimatedTotal: 95, currency: 'RUB' })), getBudget: vi.fn(async () => ({ weekCost: 500, todayCost: 95, currency: 'RUB' })) } as never,
    );

    const snapshot = await builder.buildSnapshot('user-1');
    expect(snapshot.userId).toBe('user-1');
    expect(snapshot.dataVersion).toBe(AI_CONTEXT_DATA_VERSION);
    expect(snapshot.flags.profile).toBe(true);
    expect(snapshot.flags.goal).toBe(true);
    expect(snapshot.flags.nutritionToday).toBe(true);
    expect(snapshot.flags.mealPlan).toBe(true);
    expect(snapshot.flags.workout).toBe(true);
    expect(snapshot.flags.progress).toBe(true);
    expect(snapshot.flags.shopping).toBe(true);
    expect(snapshot.flags.goalCore).toBe(true);
    expect(snapshot.data.goalCore.primaryGoal).toBe('lose_weight');
    expect(snapshot.data.goalCore.currentWeight).toBe(79);
    expect(snapshot.data.goalCore.targetWeight).toBe(75);
  });

  it('builds Russian system prompt with Goal Core and user data sections', async () => {
    const snapshot = {
      userId: 'u1',
      generatedAt: '2026-07-21T12:00:00.000Z',
      dataVersion: AI_CONTEXT_DATA_VERSION,
      flags: {
        profile: true,
        goal: false,
        goalCore: true,
        nutritionToday: true,
        mealPlan: false,
        workout: false,
        progress: false,
        shopping: false,
        prices: false,
      },
      data: {
        goalCore: {
          primaryGoal: null,
          currentWeight: 80,
          targetWeight: null,
          targetDate: null,
          activityLevel: null,
          trainingLevel: null,
          workoutsPerWeek: null,
          dietaryPreferences: null,
          restrictions: null,
          availableEquipment: null,
        },
        profile: { weightKg: 80 },
        goal: null,
        nutritionToday: { consumedKcal: 900 },
        mealPlan: null,
        workout: null,
        progress: null,
        shopping: null,
        priceIntelligence: null,
      },
    };
    const prompt = buildSystemPrompt(snapshot);
    expect(prompt).toContain('персональный AI-ассистент');
    expect(prompt).toContain('Goal Core');
    expect(prompt).toContain('Питание сегодня');
    expect(prompt).toContain('dataVersion=2');
  });
});
