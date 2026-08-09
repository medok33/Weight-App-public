import type { AIThinkingMode } from './ai-tariff.types';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type AICompletionThinking = {
  type: AIThinkingMode;
};

export type AICompletionRequest = {
  messages: ChatMessage[];
  model?: string;
  thinking?: AICompletionThinking;
  reasoningEffort?: 'high' | 'max';
};

export type AICompletionResult = {
  content: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  thinkingEnabled: boolean;
  /** Never expose to clients — kept internal for tests only when needed. */
  rawHadReasoningContent?: boolean;
};

/** Unified contract for DeepSeek, OpenAI, Local mock, and future providers. */
export interface AIProviderAdapter {
  readonly providerId: string;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}
