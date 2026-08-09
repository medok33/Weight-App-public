import { Inject, Injectable } from '@nestjs/common';
import type { AIProviderAdapter } from '../domain/ai-provider.interface';
import { buildSystemPrompt } from '../domain/ai-context.prompt';
import { detectInjection } from '../domain/ai-assistant.policy';
import {
  filterChatIntent,
  GREETING_REPLY,
  primaryTopicForContext,
} from '../domain/ai-intent.policy';
import { applyMedicalDisclaimer, assessMedicalSafety } from '../domain/ai-medical.policy';
import { classifyRequestComplexity, resolveRoutedModel } from '../domain/ai-request-router';
import { estimateDeepSeekCostUsd } from '../domain/ai-cost.estimate';
import { selectTopicContext } from '../domain/ai-context-selection';
import { toQuotaView } from '../domain/ai-tariff.types';
import type { ConversationRecord, MessageRecord, SendMessageResult } from '../domain/ai-assistant.types';
import { toContextUiLabels } from '../domain/ai-conversation-context.types';
import { AIAssistantRepository } from '../infrastructure/ai-assistant.repository';
import { AI_PROVIDER } from './ai-assistant.service';
import { AIContextBuilder } from './ai-context.builder';
import { AITariffService } from './ai-tariff.service';
import { readAIProviderKind } from '../providers/ai-provider.env';

function mapProviderFailure(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('AI_PROVIDER_TEMPORARILY_UNAVAILABLE');
  const code = error.message;
  if (code === 'AI_PROVIDER_NOT_CONFIGURED' || code === 'AI_PROVIDER_AUTH_FAILED') return error;
  if (
    code === 'AI_PROVIDER_TIMEOUT' ||
    code === 'AI_PROVIDER_RATE_LIMITED' ||
    code === 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE' ||
    code === 'AI_PROVIDER_EMPTY_RESPONSE' ||
    code === 'AI_PROVIDER_INVALID_RESPONSE' ||
    /^AI_PROVIDER_HTTP_/.test(code)
  ) {
    if (readAIProviderKind() === 'deepseek' || process.env.NODE_ENV === 'production') {
      if (code === 'AI_PROVIDER_EMPTY_RESPONSE' || code === 'AI_PROVIDER_INVALID_RESPONSE') return error;
      if (code === 'AI_PROVIDER_AUTH_FAILED' || code === 'AI_PROVIDER_NOT_CONFIGURED') return error;
      return new Error('AI_PROVIDER_TEMPORARILY_UNAVAILABLE');
    }
  }
  return error;
}

@Injectable()
export class AIChatService {
  constructor(
    @Inject(AIAssistantRepository) private readonly repository: AIAssistantRepository,
    @Inject(AIContextBuilder) private readonly contextBuilder: AIContextBuilder,
    @Inject(AITariffService) private readonly tariffService: AITariffService,
    @Inject(AI_PROVIDER) private readonly provider: AIProviderAdapter,
  ) {}

  async listConversations(userId: string): Promise<ConversationRecord[]> {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    return this.repository.listConversations(userId);
  }

  async createConversation(userId: string, title?: string): Promise<ConversationRecord> {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    return this.repository.createConversation(userId, title);
  }

  async listMessages(userId: string, conversationId: string): Promise<MessageRecord[]> {
    const conversation = await this.repository.getConversation(userId, conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    return this.repository.listMessages(conversationId);
  }

  async sendMessage(userId: string, content: string, conversationId?: string): Promise<SendMessageResult> {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    if (!content?.trim()) throw new Error('MESSAGE_EMPTY');
    if (detectInjection(content)) throw new Error('AI_INJECTION_DETECTED');
    if (!(await this.repository.control()).enabled) throw new Error('AI_KILL_SWITCH_ACTIVE');

    const tariff = await this.tariffService.resolveTariff(userId);
    const medical = assessMedicalSafety(content);
    const route = classifyRequestComplexity(content);

    let conversation: ConversationRecord;
    if (conversationId) {
      const existing = await this.repository.getConversation(userId, conversationId);
      if (!existing) throw new Error('CONVERSATION_NOT_FOUND');
      conversation = existing;
    } else {
      conversation = await this.repository.createConversation(userId, content.slice(0, 80));
    }

    // History BEFORE classifying — enables follow-ups like «что такое киноа» after prior mention.
    const priorMessages = await this.repository.listMessages(conversation.id);
    const intent = filterChatIntent(content, {
      history: priorMessages.map((m) => ({ role: m.role, content: m.content })),
      tariffTier: tariff.tier,
    });
    const contextTopic = primaryTopicForContext(intent);

    // Quota only for paid LLM turns — not greeting / clarify / offtopic refusal.
    const burnsQuota = intent.allowed && intent.topic !== 'GREETING' && intent.topic !== 'CLARIFY';
    if (burnsQuota) {
      await this.tariffService.assertWithinDailyLimit(userId, tariff);
    }

    const userMessage = await this.repository.addMessage(conversation.id, 'user', content.trim());

    if (intent.topic === 'GREETING') {
      const assistantMessage = await this.repository.addMessage(conversation.id, 'assistant', GREETING_REPLY);
      return {
        conversationId: conversation.id,
        userMessage,
        assistantMessage,
        providerId: 'policy',
        model: 'greeting',
        tariff: tariff.tier,
        complexity: route.complexity,
        topic: intent.topic,
        quotaMode: tariff.quotaMode,
      };
    }

    if (intent.topic === 'CLARIFY' && intent.clarifyQuestion) {
      const assistantMessage = await this.repository.addMessage(
        conversation.id,
        'assistant',
        intent.clarifyQuestion,
      );
      return {
        conversationId: conversation.id,
        userMessage,
        assistantMessage,
        providerId: 'policy',
        model: 'clarify',
        tariff: tariff.tier,
        complexity: route.complexity,
        topic: intent.topic,
        quotaMode: tariff.quotaMode,
      };
    }

    if (!intent.allowed) {
      const refusal = intent.refusalMessage ?? 'По этой теме я не консультирую.';
      const assistantMessage = await this.repository.addMessage(conversation.id, 'assistant', refusal);
      return {
        conversationId: conversation.id,
        userMessage,
        assistantMessage,
        providerId: 'policy',
        model: 'intent-filter',
        tariff: tariff.tier,
        complexity: route.complexity,
        topic: intent.topic,
        quotaMode: tariff.quotaMode,
      };
    }

    const model = resolveRoutedModel(route.complexity, tariff.model, tariff.tier);
    const snapshot = await this.contextBuilder.buildSnapshot(userId);
    const selected = selectTopicContext(snapshot, contextTopic);
    snapshot.selectedDomains = selected.domains;
    const history = await this.repository.listMessages(conversation.id);

    const messages = [
      {
        role: 'system' as const,
        content: buildSystemPrompt(snapshot, {
          medicalDisclaimer: medical.requiresDisclaimer,
          tariffTier: tariff.tier,
          selected,
          topic: contextTopic,
          conversation: intent.conversation,
        }),
      },
      ...history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let completion;
    try {
      completion = await this.provider.complete({
        messages,
        model,
        thinking: { type: tariff.thinking },
        reasoningEffort: tariff.thinking === 'enabled' ? tariff.reasoningEffort : undefined,
      });
    } catch (error) {
      throw mapProviderFailure(error);
    }

    const finalContent = applyMedicalDisclaimer(completion.content, medical.requiresDisclaimer);
    const assistantMessage = await this.repository.addMessage(conversation.id, 'assistant', finalContent);

    const totalTokens = completion.totalTokens ?? completion.promptTokens + completion.completionTokens;
    const estimatedCost = estimateDeepSeekCostUsd({
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
    });

    await this.repository.logUsage({
      userId,
      conversationId: conversation.id,
      providerId: completion.providerId,
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      totalTokens,
      tier: tariff.tier,
      thinkingEnabled: completion.thinkingEnabled ?? tariff.thinking === 'enabled',
      estimatedCost,
      latencyMs: completion.latencyMs ?? 0,
      success: true,
      topic: intent.topics.join('+'),
    });

    const usage = await this.tariffService.getDailyUsage(userId);
    const quota = toQuotaView(tariff, usage.requestCount);

    return {
      conversationId: conversation.id,
      userMessage,
      assistantMessage,
      providerId: completion.providerId,
      model: completion.model,
      tariff: tariff.tier,
      complexity: route.complexity,
      topic: intent.topic,
      thinkingEnabled: completion.thinkingEnabled ?? tariff.thinking === 'enabled',
      quotaMode: quota.quotaMode,
      usage: {
        date: usage.date,
        requestCount: usage.requestCount,
        dailyLimit: quota.limit,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCost,
        latencyMs: completion.latencyMs ?? 0,
        quotaMode: quota.quotaMode,
        limit: quota.limit,
        used: quota.used,
        remaining: quota.remaining,
      },
      context: {
        userId: snapshot.userId,
        generatedAt: snapshot.generatedAt,
        dataVersion: snapshot.dataVersion,
        flags: snapshot.flags,
        ui: toContextUiLabels(snapshot.flags),
      },
    };
  }

  async getContextSnapshot(userId: string) {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    const snapshot = await this.contextBuilder.buildSnapshot(userId);
    return {
      ...snapshot,
      ui: toContextUiLabels(snapshot.flags),
    };
  }

  async getUsage(userId: string) {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    const tariff = await this.tariffService.resolveTariff(userId);
    const usage = await this.tariffService.getDailyUsage(userId);
    const quota = toQuotaView(tariff, usage.requestCount);
    return {
      tariff: tariff.tier,
      model: tariff.model,
      thinking: tariff.thinking,
      dailyLimit: quota.limit,
      quotaMode: quota.quotaMode,
      limit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
      ...usage,
      requestCount: usage.requestCount,
    };
  }

  async submitFeedback(userId: string, messageId: string, rating: 'up' | 'down') {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    if (!messageId) throw new Error('MESSAGE_ID_REQUIRED');
    if (rating !== 'up' && rating !== 'down') throw new Error('FEEDBACK_INVALID');

    const message = await this.repository.getMessageForUser(userId, messageId);
    if (!message) throw new Error('MESSAGE_NOT_FOUND');
    if (message.role !== 'assistant') throw new Error('FEEDBACK_ASSISTANT_ONLY');

    return this.repository.upsertMessageFeedback(userId, messageId, rating);
  }

  async listMessageFeedback(userId: string, messageIds: string[]) {
    if (!userId) throw new Error('USER_ID_REQUIRED');
    return this.repository.listMessageFeedback(userId, messageIds);
  }
}
