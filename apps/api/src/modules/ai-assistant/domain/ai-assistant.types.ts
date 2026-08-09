import type { AIProviderAdapter } from './ai-provider.interface';

/** @deprecated use AIProviderAdapter — kept for legacy complete() callers */
export type AIProvider = { name: string; complete: (prompt: string) => Promise<string> };

export type AIIntent = 'meal_explanation' | 'habit_coach';

export type PromptVersion = { intent: AIIntent; version: string; template: string };

export type AIQuota = { tokens: number; cost: number; maxTokens: number; maxCost: number };

export type ConversationRecord = {
  id: string;
  userId: string;
  title?: string;
  createdAt: string;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export type AIUsageLogRecord = {
  id: string;
  userId: string;
  conversationId?: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
};

export type AIUserContext = {
  profile: Record<string, unknown> | null;
  goal: Record<string, unknown> | null;
  mealPlan: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  shopping: Record<string, unknown> | null;
  prices: Record<string, unknown> | null;
};

export type SendMessageResult = {
  conversationId: string;
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  providerId: string;
  model: string;
  tariff?: 'FREE' | 'PREMIUM';
  complexity?: 'SIMPLE' | 'ANALYSIS';
  topic?: string;
  thinkingEnabled?: boolean;
  quotaMode?: 'LIMITED' | 'UNLIMITED';
  usage?: {
    date: string;
    requestCount: number;
    dailyLimit: number | null;
    promptTokens: number;
    completionTokens: number;
    estimatedCost?: number;
    latencyMs?: number;
    quotaMode?: 'LIMITED' | 'UNLIMITED';
    limit?: number | null;
    used?: number;
    remaining?: number | null;
  };
  context?: import('./ai-conversation-context.types').ContextSnapshotSummary;
};

export type { AIConversationContext, ContextSnapshotSummary, ContextUiLabels } from './ai-conversation-context.types';

export { type AIProviderAdapter };
