import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalProvider } from '../providers/local.provider';
import { DeepSeekProvider } from '../providers/deepseek.provider';
import { createAIProvider } from '../providers/ai-provider.factory';
import {
  logAIProviderStartupStatus,
  readDeepSeekConfig,
  resolveAIProviderStartupStatus,
} from '../providers/ai-provider.env';

describe('AI providers', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it('LocalProvider returns mock response without API key', async () => {
    const provider = new LocalProvider();
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Привет' }],
    });
    expect(result.providerId).toBe('local');
    expect(result.content).toMatch(/Привет|ассистент|питание/i);
  });

  it('DeepSeek throws when DEEPSEEK_API_KEY is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AI_DEEPSEEK_API_KEY;
    const provider = new DeepSeekProvider();
    expect(provider.configured).toBe(false);
    await expect(provider.complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow(
      'AI_PROVIDER_NOT_CONFIGURED',
    );
  });

  it('DeepSeek calls API when key is set (without logging key)', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-only';
    process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Ответ DeepSeek' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'deepseek-v4-flash',
        }),
        { status: 200 },
      ),
    );

    const provider = new DeepSeekProvider();
    expect(provider.configured).toBe(true);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    });
    expect(result.content).toBe('Ответ DeepSeek');
    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('deepseek.com');
    expect(readDeepSeekConfig().apiKey).toBe('test-key-only');
  });

  it('factory selects provider by kind', () => {
    expect(createAIProvider('local').providerId).toBe('local');
    expect(createAIProvider('deepseek').providerId).toBe('deepseek');
    expect(createAIProvider('openai').providerId).toBe('openai');
    expect(createAIProvider('local-llm').providerId).toBe('local-llm');
  });

  it('startup status is disabled without DeepSeek key', () => {
    process.env.AI_PROVIDER = 'deepseek';
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AI_DEEPSEEK_API_KEY;
    expect(resolveAIProviderStartupStatus()).toBe('disabled');
  });

  it('startup status is enabled with DeepSeek key', () => {
    process.env.AI_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'secret';
    expect(resolveAIProviderStartupStatus()).toBe('enabled');
  });

  it('startup log never prints API key', () => {
    process.env.AI_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'super-secret-key';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logAIProviderStartupStatus();
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('super-secret-key');
    expect(logged).toContain('apiKey=configured');
    expect(logged).toContain('deepseek-v4-flash');
  });
});
