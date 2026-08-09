import { describe, expect, it, vi } from 'vitest';
import { assessGoalPace, buildGoalCore } from '../domain/ai-goal-core';
import { domainsForTopic, selectTopicContext } from '../domain/ai-context-selection';
import { filterChatIntent, GREETING_REPLY, primaryTopicForContext } from '../domain/ai-intent.policy';
import { buildSystemPrompt } from '../domain/ai-context.prompt';
import { AI_CONTEXT_DATA_VERSION } from '../domain/ai-conversation-context.types';
import { getTariffConfig, toQuotaView } from '../domain/ai-tariff.types';
import { AITariffService } from '../application/ai-tariff.service';
import { AIChatService } from '../application/ai-chat.service';
import { LocalProvider } from '../providers/local.provider';

function emptySnapshot() {
  return {
    userId: 'u1',
    generatedAt: '2026-07-21T12:00:00.000Z',
    dataVersion: AI_CONTEXT_DATA_VERSION,
    flags: {
      profile: true,
      goal: true,
      goalCore: true,
      nutritionToday: true,
      mealPlan: true,
      workout: true,
      progress: true,
      shopping: true,
      prices: true,
    },
    data: {
      goalCore: buildGoalCore({
        profile: { weightKg: 90, activityLevel: 'moderate', trainingLevel: 'BEGINNER', workoutsPerWeek: 3 },
        goal: { kind: 'lose_weight', target: 85, unit: 'kg', targetDate: '2026-08-20' },
        progress: { latestWeightKg: 90 },
        workout: { days: [{ dayIndex: 0 }] },
      }),
      profile: { weightKg: 90 },
      goal: { kind: 'lose_weight', target: 85, unit: 'kg', targetDate: '2026-08-20' },
      nutritionToday: { consumedKcal: 900 },
      mealPlan: { days: [{ mealName: 'quinoa_bowl' }] },
      workout: { days: [{ exerciseName: 'morning_walk' }] },
      progress: { latestWeightKg: 90 },
      shopping: {
        itemCount: 2,
        items: [
          {
            name: 'oats',
            estimatedCost: 95,
            priceSourceType: 'OPEN_DATA',
            priceSourceName: 'demo',
            collectedAt: '2026-07-20',
            priceStatus: 'OBSERVED',
          },
          { name: 'unknown', estimatedCost: null, priceStatus: 'MISSING' },
        ],
      },
      priceIntelligence: {
        weekBudget: 500,
        missingPriceCount: 1,
        budgetIsApproximate: true,
        items: [],
      },
    },
  };
}

describe('Conversation quality intents', () => {
  it('classifies quinoa, follow-up, celebrities, shopping, greeting', () => {
    expect(filterChatIntent('Что такое киноа?').topic).toBe('FOOD_PRODUCT');
    expect(filterChatIntent('Что такое киноа?').allowed).toBe(true);

    const follow = filterChatIntent('Мне не нравится и непонятно, что такое киноа', {
      history: [{ role: 'assistant', content: 'Сегодня в плане киноа с овощами.' }],
    });
    expect(follow.allowed).toBe(true);
    expect(follow.topics).toContain('FOLLOW_UP');
    expect(follow.topics.some((t) => t === 'FOOD_PRODUCT' || t === 'FOLLOW_UP')).toBe(true);

    expect(filterChatIntent('Как тренировался Шварценеггер?').topic).toBe('CELEBRITY_TRAINING');
    expect(filterChatIntent('Как тренировался Фрэнк Зейн?').topic).toBe('CELEBRITY_TRAINING');
    expect(filterChatIntent('Собери продукты на неделю').topic).toBe('SHOPPING');
    expect(filterChatIntent('Привет').topic).toBe('GREETING');
  });

  it('does not offtopic short ambiguous messages — clarifies instead', () => {
    const r = filterChatIntent('ну и что');
    expect(r.topic).toBe('CLARIFY');
    expect(r.allowed).toBe(true);
    expect(r.clarifyQuestion).toBeTruthy();
  });
});

describe('Goal pace', () => {
  it('marks 90→85 in ~30 days as AGGRESSIVE by weekly pace', () => {
    const core = buildGoalCore({
      profile: { weightKg: 90 },
      goal: { kind: 'lose_weight', target: 85, unit: 'kg', targetDate: '2026-08-20' },
    });
    const pace = assessGoalPace(core, new Date('2026-07-21T00:00:00.000Z'));
    expect(pace.status).toBe('AGGRESSIVE');
    expect(pace.requiredChangePerWeek!).toBeGreaterThan(1);
  });

  it('returns INSUFFICIENT_DATA without targetDate', () => {
    const core = buildGoalCore({
      profile: { weightKg: 100 },
      goal: { kind: 'lose_weight', target: 85, unit: 'kg' },
    });
    expect(assessGoalPace(core).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('Chat pipeline quality', () => {
  function makeService(opts?: { tier?: 'FREE' | 'PREMIUM'; owner?: boolean }) {
    const stored: Array<{ id: string; conversationId: string; role: string; content: string; createdAt: string }> = [];
    const repo = {
      control: vi.fn(async () => ({ enabled: true, updatedAt: new Date().toISOString() })),
      createConversation: vi.fn(async (userId: string) => ({
        id: 'c1',
        userId,
        createdAt: new Date().toISOString(),
      })),
      getConversation: vi.fn(async () => ({ id: 'c1', userId: 'u1', createdAt: new Date().toISOString() })),
      addMessage: vi.fn(async (conversationId: string, role: string, content: string) => {
        const msg = {
          id: `m${stored.length}`,
          conversationId,
          role,
          content,
          createdAt: new Date().toISOString(),
        };
        stored.push(msg);
        return msg;
      }),
      listMessages: vi.fn(async () => [...stored]),
      logUsage: vi.fn(async () => ({ id: 'log' })),
    };
    const contextBuilder = { buildSnapshot: vi.fn(async () => emptySnapshot()) };
    const tariff = opts?.owner
      ? getTariffConfig('PREMIUM', { ownerUnlimited: true })
      : getTariffConfig(opts?.tier ?? 'FREE');
    const tariffService = {
      resolveTariff: vi.fn(async () => tariff),
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
        models: [tariff.model],
      })),
    };
    const provider = new LocalProvider();
    const service = new AIChatService(repo as never, contextBuilder as never, tariffService as never, provider);
    return { service, repo, provider, stored, tariffService };
  }

  it('GREETING returns short hello without LLM usage log', async () => {
    const { service, repo, provider } = makeService();
    const spy = vi.spyOn(provider, 'complete');
    const result = await service.sendMessage('u1', 'Привет');
    expect(result.assistantMessage.content).toBe(GREETING_REPLY);
    expect(result.providerId).toBe('policy');
    expect(spy).not.toHaveBeenCalled();
    expect(repo.logUsage).not.toHaveBeenCalled();
  });

  it('QUINOA follow-up is allowed and explains replacements', async () => {
    const { service, provider, stored } = makeService();
    stored.push({
      id: 'a0',
      conversationId: 'c1',
      role: 'assistant',
      content: 'На ужин подойдёт киноа с овощами.',
      createdAt: new Date().toISOString(),
    });
    const spy = vi.spyOn(provider, 'complete');
    const result = await service.sendMessage('u1', 'Мне не нравится и непонятно, что такое киноа');
    expect(result.providerId).not.toBe('policy');
    expect(result.assistantMessage.content.toLowerCase()).toContain('киноа');
    expect(result.assistantMessage.content).toMatch(/рис|гречк|булгур|макарон/i);
    const system = spy.mock.calls[0]?.[0].messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('Goal Core');
    expect(system).toMatch(/продолжен|entities|киноа|Follow|диалог/i);
  });

  it('ARNOLD on PREMIUM calls LLM without policy refusal', async () => {
    const { service, repo } = makeService({ tier: 'PREMIUM' });
    const result = await service.sendMessage('u1', 'Как тренировался Шварценеггер?');
    expect(result.topic).toBe('CELEBRITY_TRAINING');
    expect(result.assistantMessage.content).toMatch(/публично известным данным/i);
    expect(result.assistantMessage.content).not.toMatch(/не консультирую|оффтоп/i);
    expect(repo.logUsage).toHaveBeenCalled();
  });

  it('OWNER unlimited after 100 requests', async () => {
    const auth = { getAccountRole: vi.fn(async () => 'OWNER'), getSubscription: vi.fn(async () => null) };
    const repo = {
      hasPremiumEntitlement: vi.fn(async () => false),
      getDailyUsage: vi.fn(async () => ({
        userId: 'o',
        date: '2026-07-21',
        requestCount: 100,
        promptTokens: 1,
        completionTokens: 1,
        models: [],
      })),
    };
    const svc = new AITariffService(repo as never, auth as never);
    const tariff = await svc.resolveTariff('o');
    expect(tariff.quotaMode).toBe('UNLIMITED');
    await expect(svc.assertWithinDailyLimit('o', tariff)).resolves.toMatchObject({ requestCount: 100 });
    expect(toQuotaView(tariff, 100).remaining).toBeNull();
  });

  it('selects shopping domain for shopping topic', () => {
    expect(domainsForTopic('SHOPPING')).toContain('SHOPPING');
    const selected = selectTopicContext(emptySnapshot() as never, 'SHOPPING');
    expect(selected.data.priceIntelligence).not.toBeNull();
    expect(selected.data.workout).toBeNull();
  });

  it('unwraps FOLLOW_UP to parent topic for context', () => {
    const intent = filterChatIntent('замени это', {
      history: [{ role: 'assistant', content: 'Попробуйте киноа на ужин.' }],
    });
    expect(intent.topic).toBe('FOLLOW_UP');
    expect(primaryTopicForContext(intent)).toBeTruthy();
  });
});

describe('Prompt contains Goal Core without full dump for greeting domains', () => {
  it('embeds pace assessment', () => {
    const snapshot = emptySnapshot();
    const prompt = buildSystemPrompt(snapshot as never, {
      tariffTier: 'PREMIUM',
      selected: selectTopicContext(snapshot as never, 'WEIGHT_GOAL'),
      topic: 'WEIGHT_GOAL',
    });
    expect(prompt).toContain('Goal Core');
    expect(prompt).toContain('AGGRESSIVE');
  });
});
