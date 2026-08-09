import type { AICompletionRequest, AICompletionResult, AIProviderAdapter } from '../domain/ai-provider.interface';
import { readDeepSeekConfig } from './ai-provider.env';
import { postChatCompletions } from './openai-compatible.client';

/**
 * DeepSeek V4 provider — reads `DEEPSEEK_API_KEY` from env.
 * Does not call the API when the key is missing.
 * Never falls back to LocalProvider.
 */
export class DeepSeekProvider implements AIProviderAdapter {
  readonly providerId = 'deepseek';
  private readonly config = readDeepSeekConfig();

  get configured(): boolean {
    return this.config.configured;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    if (!this.config.configured) throw new Error('AI_PROVIDER_NOT_CONFIGURED');

    const thinking = request.thinking ?? { type: 'disabled' as const };
    return postChatCompletions({
      baseUrl: `${this.config.baseUrl}/v1`,
      apiKey: this.config.apiKey,
      model: request.model ?? this.config.model,
      messages: request.messages,
      providerId: this.providerId,
      thinking,
      reasoningEffort: thinking.type === 'enabled' ? request.reasoningEffort ?? this.config.reasoningEffort : undefined,
    });
  }
}
