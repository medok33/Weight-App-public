import { describe, expect, it } from 'vitest';
import { AI_TARIFFS, getTariffConfig } from '../domain/ai-tariff.types';
import { classifyRequestComplexity, resolveRoutedModel } from '../domain/ai-request-router';
import { filterChatIntent, OFFTOPIC_REFUSAL } from '../domain/ai-intent.policy';
import { assessMedicalSafety, applyMedicalDisclaimer, MEDICAL_DISCLAIMER } from '../domain/ai-medical.policy';
import { formatMockStyleResponse, RESPONSE_STYLE_INSTRUCTION } from '../domain/ai-response-style';
import { buildSystemPrompt } from '../domain/ai-context.prompt';
import { AI_CONTEXT_DATA_VERSION } from '../domain/ai-conversation-context.types';

describe('AI business logic', () => {
  it('defines FREE and PREMIUM tariffs', () => {
    expect(AI_TARIFFS.FREE.model).toBe('deepseek-v4-flash');
    expect(AI_TARIFFS.FREE.dailyRequestLimit).toBe(20);
    expect(AI_TARIFFS.PREMIUM.model).toBe('deepseek-v4-pro');
    expect(AI_TARIFFS.PREMIUM.dailyRequestLimit).toBe(30);
    expect(getTariffConfig('FREE').quotaMode).toBe('LIMITED');
  });

  it('routes by tariff model', () => {
    expect(resolveRoutedModel('SIMPLE', 'deepseek-v4-flash', 'FREE')).toBe('deepseek-v4-flash');
    expect(resolveRoutedModel('ANALYSIS', 'deepseek-v4-pro', 'PREMIUM')).toBe('deepseek-v4-pro');
    expect(classifyRequestComplexity('Привет').complexity).toBe('SIMPLE');
  });

  it('allows nutrition/products and refuses clear offtopic', () => {
    expect(filterChatIntent('10 яиц каждый день').allowed).toBe(true);
    expect(filterChatIntent('почему хочется сладкого').topic).toBe('NUTRITION');
    expect(filterChatIntent('как похудеть').topic).toBe('WEIGHT_GOAL');
    expect(filterChatIntent('список покупок').topic).toBe('SHOPPING');
    const off = filterChatIntent('Кто выиграл чемпионат мира по футболу в прошлом веке и какой был счёт матча финала?');
    expect(off.allowed).toBe(false);
    expect(off.refusalMessage).toBe(OFFTOPIC_REFUSAL);
  });

  it('medical disclaimer only for clinical topics', () => {
    expect(assessMedicalSafety('10 яиц каждый день').requiresDisclaimer).toBe(false);
    expect(assessMedicalSafety('У меня температура и боль в груди — какой диагноз?').requiresDisclaimer).toBe(true);
    expect(applyMedicalDisclaimer('Ответ', true)).toContain(MEDICAL_DISCLAIMER);
  });

  it('embeds response style in system prompt', () => {
    expect(RESPONSE_STYLE_INSTRUCTION).toContain('Сразу отвечай');
    const styled = formatMockStyleResponse('Короткий ответ.', ['пункт 1'], 'Сделайте X');
    expect(styled).toContain('• пункт 1');
    const prompt = buildSystemPrompt({
      userId: 'u1',
      generatedAt: '2026-07-21T12:00:00.000Z',
      dataVersion: AI_CONTEXT_DATA_VERSION,
      flags: {
        profile: false,
        goal: false,
        goalCore: false,
        nutritionToday: false,
        mealPlan: false,
        workout: false,
        progress: false,
        shopping: false,
        prices: false,
      },
      data: {
        goalCore: {
          primaryGoal: null,
          currentWeight: null,
          targetWeight: null,
          targetDate: null,
          activityLevel: null,
          trainingLevel: null,
          workoutsPerWeek: null,
          dietaryPreferences: null,
          restrictions: null,
          availableEquipment: null,
        },
        profile: null,
        goal: null,
        nutritionToday: null,
        mealPlan: null,
        workout: null,
        progress: null,
        shopping: null,
        priceIntelligence: null,
      },
    });
    expect(prompt).toContain('Goal Core');
  });
});
