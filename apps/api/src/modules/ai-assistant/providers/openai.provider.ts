import type { AICompletionRequest, AICompletionResult, AIProviderAdapter } from '../domain/ai-provider.interface';
import { readOpenAIConfig } from './ai-provider.env';
import { postChatCompletions } from './openai-compatible.client';

/** OpenAI provider — reads `OPENAI_API_KEY` from env. */
export class OpenAIProvider implements AIProviderAdapter {
  readonly providerId = 'openai';
  private readonly config = readOpenAIConfig();

  get configured(): boolean {
    return this.config.configured;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    if (!this.config.configured) throw new Error('AI_PROVIDER_NOT_CONFIGURED');

    return postChatCompletions({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      model: request.model ?? this.config.model,
      messages: request.messages,
      providerId: this.providerId,
    });
  }
}
