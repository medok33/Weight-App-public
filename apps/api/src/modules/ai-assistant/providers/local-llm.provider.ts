import type { AICompletionRequest, AICompletionResult, AIProviderAdapter } from '../domain/ai-provider.interface';
import { readLocalLlmConfig } from './ai-provider.env';
import { postChatCompletions } from './openai-compatible.client';

/**
 * Local LLM provider (Ollama / OpenAI-compatible local endpoint).
 * Enabled when `LOCAL_LLM_BASE_URL` is set.
 */
export class LocalLlmProvider implements AIProviderAdapter {
  readonly providerId = 'local-llm';
  private readonly config = readLocalLlmConfig();

  get configured(): boolean {
    return this.config.configured;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    if (!this.config.configured) throw new Error('AI_PROVIDER_NOT_CONFIGURED');

    return postChatCompletions({
      baseUrl: `${this.config.baseUrl}/v1`,
      model: request.model ?? this.config.model,
      messages: request.messages,
      providerId: this.providerId,
    });
  }
}
