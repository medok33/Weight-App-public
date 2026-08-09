import type { ChatMessage } from '../domain/ai-provider.interface';
import type { AICompletionResult } from '../domain/ai-provider.interface';
import type { AIThinkingMode } from '../domain/ai-tariff.types';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
  model?: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function mapHttpError(status: number): Error {
  if (status === 401 || status === 403) return new Error('AI_PROVIDER_AUTH_FAILED');
  if (status === 429) return new Error('AI_PROVIDER_RATE_LIMITED');
  if (status >= 500) return new Error('AI_PROVIDER_TEMPORARILY_UNAVAILABLE');
  return new Error(`AI_PROVIDER_HTTP_${status}`);
}

async function once(input: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  providerId: string;
  thinking?: { type: AIThinkingMode };
  reasoningEffort?: 'high' | 'max';
  timeoutMs: number;
}): Promise<AICompletionResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  if (input.thinking) {
    body.thinking = { type: input.thinking.type };
  }
  if (input.thinking?.type === 'enabled' && input.reasoningEffort) {
    body.reasoning_effort = input.reasoningEffort;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI_PROVIDER_TIMEOUT');
    }
    throw new Error('AI_PROVIDER_TEMPORARILY_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw mapHttpError(response.status);
  }

  let parsed: ChatCompletionResponse;
  try {
    parsed = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new Error('AI_PROVIDER_INVALID_RESPONSE');
  }

  const message = parsed.choices?.[0]?.message;
  const content = message?.content?.trim() ?? '';
  const hadReasoning = Boolean(message?.reasoning_content && String(message.reasoning_content).length > 0);
  // Never return or persist reasoning_content — only final content.
  if (!content) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');

  const promptTokens = parsed.usage?.prompt_tokens ?? 0;
  const completionTokens = parsed.usage?.completion_tokens ?? 0;
  const totalTokens = parsed.usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    content,
    providerId: input.providerId,
    model: parsed.model ?? input.model,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs: Date.now() - started,
    thinkingEnabled: input.thinking?.type === 'enabled',
    rawHadReasoningContent: hadReasoning,
  };
}

/** Shared OpenAI-compatible chat/completions client (DeepSeek, OpenAI, Ollama). */
export async function postChatCompletions(input: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  providerId: string;
  thinking?: { type: AIThinkingMode };
  reasoningEffort?: 'high' | 'max';
  timeoutMs?: number;
}): Promise<AICompletionResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await once({ ...input, timeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const retryable =
      message === 'AI_PROVIDER_TIMEOUT' ||
      message === 'AI_PROVIDER_RATE_LIMITED' ||
      message === 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE' ||
      /^AI_PROVIDER_HTTP_5\d\d$/.test(message);
    if (!retryable) throw error;
    // One retry only for timeout / 429 / 5xx.
    return once({ ...input, timeoutMs });
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === 'AI_PROVIDER_TIMEOUT' ||
    error.message === 'AI_PROVIDER_RATE_LIMITED' ||
    error.message === 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE' ||
    isRetryableStatus(Number(error.message.replace('AI_PROVIDER_HTTP_', '')))
  );
}
