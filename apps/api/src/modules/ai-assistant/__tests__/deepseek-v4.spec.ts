import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalProvider } from '../providers/local.provider';
import { DeepSeekProvider } from '../providers/deepseek.provider';
import { createAIProvider } from '../providers/ai-provider.factory';
import {
  describeProviderPublicStatus,
  logAIProviderStartupStatus,
  readDeepSeekConfig,
  resolveAIProviderStartupStatus,
} from '../providers/ai-provider.env';
import { AI_TARIFFS, RETIRED_DEEPSEEK_ALIASES, getTariffConfig } from '../domain/ai-tariff.types';
import { classifyRequestComplexity, resolveRoutedModel } from '../domain/ai-request-router';
import { postChatCompletions } from '../providers/openai-compatible.client';

describe('DeepSeek V4 migration', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it('FREE → v4-flash + thinking disabled; PREMIUM → v4-pro + thinking enabled', () => {
    expect(AI_TARIFFS.FREE.model).toBe('deepseek-v4-flash');
    expect(AI_TARIFFS.FREE.thinking).toBe('disabled');
    expect(AI_TARIFFS.FREE.dailyRequestLimit).toBe(20);
    expect(AI_TARIFFS.PREMIUM.model).toBe('deepseek-v4-pro');
    expect(AI_TARIFFS.PREMIUM.thinking).toBe('enabled');
    expect(AI_TARIFFS.PREMIUM.reasoningEffort).toBe('high');
    expect(AI_TARIFFS.PREMIUM.dailyRequestLimit).toBe(30);
    expect(getTariffConfig('FREE').model).toBe('deepseek-v4-flash');
    expect(getTariffConfig('PREMIUM').model).toBe('deepseek-v4-pro');
  });

  it('retired aliases are not used in tariff routing', () => {
    for (const alias of RETIRED_DEEPSEEK_ALIASES) {
      expect(AI_TARIFFS.FREE.model).not.toBe(alias);
      expect(AI_TARIFFS.PREMIUM.model).not.toBe(alias);
      expect(resolveRoutedModel('ANALYSIS', AI_TARIFFS.FREE.model, 'FREE')).not.toBe(alias);
      expect(resolveRoutedModel('SIMPLE', AI_TARIFFS.PREMIUM.model, 'PREMIUM')).not.toBe(alias);
    }
    expect(resolveRoutedModel('ANALYSIS', 'deepseek-v4-flash', 'FREE')).toBe('deepseek-v4-flash');
    expect(resolveRoutedModel('ANALYSIS', 'deepseek-v4-pro', 'PREMIUM')).toBe('deepseek-v4-pro');
    expect(classifyRequestComplexity('анализ рациона').complexity).toBe('ANALYSIS');
  });

  it('DeepSeek FREE request body disables thinking', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-only';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Краткий ответ', reasoning_content: 'secret chain' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'deepseek-v4-flash',
        }),
        { status: 200 },
      ),
    );
    const provider = new DeepSeekProvider();
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    });
    expect(result.content).toBe('Краткий ответ');
    expect(result.rawHadReasoningContent).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret chain');
    expect(JSON.stringify(result)).not.toContain('reasoning_content');
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('DeepSeek PREMIUM request body enables thinking + reasoning_effort high', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-only';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Финальный ответ', reasoning_content: 'hidden' } }],
          usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
          model: 'deepseek-v4-pro',
        }),
        { status: 200 },
      ),
    );
    const provider = new DeepSeekProvider();
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'анализ' }],
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
      reasoningEffort: 'high',
    });
    expect(result.content).toBe('Финальный ответ');
    expect(result.thinkingEnabled).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
  });

  it('retries once on 429 then succeeds', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-only';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok after retry' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            model: 'deepseek-v4-flash',
          }),
          { status: 200 },
        ),
      );
    const result = await postChatCompletions({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key-only',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'x' }],
      providerId: 'deepseek',
      thinking: { type: 'disabled' },
    });
    expect(result.content).toBe('ok after retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('provider status never returns api key value', () => {
    process.env.AI_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'super-secret-key';
    const status = describeProviderPublicStatus();
    expect(status.apiKey).toBe('configured');
    expect(status.freeModel).toBe('deepseek-v4-flash');
    expect(status.premiumModel).toBe('deepseek-v4-pro');
    expect(JSON.stringify(status)).not.toContain('super-secret-key');
  });

  it('LocalProvider still works only when selected', async () => {
    expect(createAIProvider('local').providerId).toBe('local');
    const provider = new LocalProvider();
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Привет' }] });
    expect(result.providerId).toBe('local');
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('startup status disabled without key', () => {
    process.env.AI_PROVIDER = 'deepseek';
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AI_DEEPSEEK_API_KEY;
    expect(resolveAIProviderStartupStatus()).toBe('disabled');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logAIProviderStartupStatus();
    expect(spy.mock.calls.join(' ')).not.toMatch(/sk-|super-secret|apiKey=\w{8,}/);
  });

  it('readDeepSeekConfig does not default to retired aliases', () => {
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.AI_DEEPSEEK_MODEL;
    const cfg = readDeepSeekConfig();
    expect(cfg.freeModel).toBe('deepseek-v4-flash');
    expect(cfg.premiumModel).toBe('deepseek-v4-pro');
    expect(RETIRED_DEEPSEEK_ALIASES).not.toContain(cfg.freeModel as never);
  });
});
