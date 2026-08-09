import { describe, expect, it, vi } from 'vitest';
import { AIChatService } from '../application/ai-chat.service';
import { LocalProvider } from '../providers/local.provider';
import type { AIAssistantRepository } from '../infrastructure/ai-assistant.repository';
import type { AIContextBuilder } from '../application/ai-context.builder';
import type { AITariffService } from '../application/ai-tariff.service';
import { AI_CONTEXT_DATA_VERSION } from '../domain/ai-conversation-context.types';
import { MEDICAL_DISCLAIMER } from '../domain/ai-medical.policy';

describe('AI chat business pipeline', () => {
  const storedMessages: Array<{ id: string; conversationId: string; role: string; content: string; createdAt: string }> = [];

  const repo = {
    control: vi.fn(async () => ({ enabled: true, updatedAt: new Date().toISOString() })),
    createConversation: vi.fn(async (userId: string, title?: string) => ({
      id: 'conv-1',
      userId,
      title,
      createdAt: new Date().toISOString(),
    })),
    getConversation: vi.fn(async () => ({ id: 'conv-1', userId: 'u1', createdAt: new Date().toISOString() })),
    addMessage: vi.fn(async (conversationId: string, role: string, content: string) => {
      const msg = {
        id: `msg-${role}-${storedMessages.length}`,
        conversationId,
        role,
        content,
        createdAt: new Date().toISOString(),
      };
      storedMessages.push(msg);
      return msg;
    }),
    listMessages: vi.fn(async () => [...storedMessages]),
    logUsage: vi.fn(async () => ({
      id: 'log-1',
      userId: 'u1',
      providerId: 'local',
      model: 'deepseek-v4-flash',
      promptTokens: 10,
      completionTokens: 20,
      createdAt: new Date().toISOString(),
    })),
    hasPremiumEntitlement: vi.fn(async () => false),
    getDailyUsage: vi.fn(async () => ({
      userId: 'u1',
      date: '2026-07-21',
      requestCount: 1,
      promptTokens: 10,
      completionTokens: 20,
      models: ['deepseek-v4-flash'],
    })),
  } as unknown as AIAssistantRepository;

  const contextBuilder = {
    buildSnapshot: vi.fn(async (userId: string) => ({
      userId,
      generatedAt: '2026-07-21T12:00:00.000Z',
      dataVersion: AI_CONTEXT_DATA_VERSION,
      flags: {
        profile: true,
        goal: false,
        goalCore: true,
        nutritionToday: true,
        mealPlan: true,
        workout: false,
        progress: true,
        shopping: true,
        prices: true,
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
        nutritionToday: { consumedKcal: 500 },
        mealPlan: { days: [] },
        workout: null,
        progress: { deltaKg: -1 },
        shopping: { itemCount: 3 },
        priceIntelligence: { weekBudget: 400 },
      },
    })),
  } as unknown as AIContextBuilder;

  const tariffService = {
    resolveTariff: vi.fn(async () => ({
      tier: 'FREE' as const,
      model: 'deepseek-v4-flash',
      dailyRequestLimit: 20,
      entitlementKey: null,
      thinking: 'disabled' as const,
      quotaMode: 'LIMITED' as const,
    })),
    assertWithinDailyLimit: vi.fn(async () => ({
      userId: 'u1',
      date: '2026-07-21',
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      models: [],
    })),
    getDailyUsage: vi.fn(async () => ({
      userId: 'u1',
      date: '2026-07-21',
      requestCount: 1,
      promptTokens: 10,
      completionTokens: 20,
      models: ['deepseek-v4-flash'],
    })),
  } as unknown as AITariffService;

  it('answers nutrition questions with tariff + style', async () => {
    storedMessages.length = 0;
    const provider = new LocalProvider();
    const completeSpy = vi.spyOn(provider, 'complete');
    const service = new AIChatService(repo, contextBuilder, tariffService, provider);

    const result = await service.sendMessage('u1', '10 яиц каждый день — нормально?');

    expect(result.tariff).toBe('FREE');
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.thinkingEnabled).toBe(false);
    expect(result.assistantMessage.content).toMatch(/Яйца|белк/i);
    expect(result.assistantMessage.content).not.toContain(MEDICAL_DISCLAIMER);
    expect(completeSpy.mock.calls[0]?.[0].model).toBe('deepseek-v4-flash');
    expect(completeSpy.mock.calls[0]?.[0].thinking).toEqual({ type: 'disabled' });
    expect(repo.logUsage).toHaveBeenCalled();
  });

  it('refuses offtopic politely without provider call and without quota burn', async () => {
    storedMessages.length = 0;
    vi.mocked(repo.logUsage).mockClear();
    const provider = new LocalProvider();
    const completeSpy = vi.spyOn(provider, 'complete');
    const service = new AIChatService(repo, contextBuilder, tariffService, provider);

    const result = await service.sendMessage(
      'u1',
      'Кто выиграл чемпионат мира по футболу в прошлом веке и какой был счёт матча финала?',
    );
    expect(result.providerId).toBe('policy');
    expect(result.assistantMessage.content).toContain('питанием');
    expect(completeSpy).not.toHaveBeenCalled();
    expect(repo.logUsage).not.toHaveBeenCalled();
  });

  it('does not burn quota when provider fails', async () => {
    storedMessages.length = 0;
    vi.mocked(repo.logUsage).mockClear();
    const provider = {
      providerId: 'deepseek',
      complete: vi.fn(async () => {
        throw new Error('AI_PROVIDER_TEMPORARILY_UNAVAILABLE');
      }),
    };
    const service = new AIChatService(repo, contextBuilder, tariffService, provider as never);
    await expect(service.sendMessage('u1', 'как похудеть')).rejects.toThrow('AI_PROVIDER_TEMPORARILY_UNAVAILABLE');
    expect(repo.logUsage).not.toHaveBeenCalled();
  });

  it('adds medical disclaimer for clinical questions', async () => {
    storedMessages.length = 0;
    const service = new AIChatService(repo, contextBuilder, tariffService, new LocalProvider());
    // "лечение" triggers clinical; also need an allowed topic — mix with nutrition
    const result = await service.sendMessage('u1', 'При болезни и лечении чем питаться?');
    expect(result.assistantMessage.content).toContain(MEDICAL_DISCLAIMER);
  });

  it('enforces daily limit', async () => {
    const limitedTariff = {
      ...tariffService,
      assertWithinDailyLimit: vi.fn(async () => {
        throw new Error('AI_DAILY_LIMIT_EXCEEDED');
      }),
    } as unknown as AITariffService;
    const service = new AIChatService(repo, contextBuilder, limitedTariff, new LocalProvider());
    await expect(service.sendMessage('u1', 'как похудеть')).rejects.toThrow('AI_DAILY_LIMIT_EXCEEDED');
  });
});
