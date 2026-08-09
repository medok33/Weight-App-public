import { Inject, Injectable } from '@nestjs/common';
import type { AIConversationContext, AIUserContext, ContextSnapshotSummary } from '../domain/ai-conversation-context.types';
import { toContextUiLabels } from '../domain/ai-conversation-context.types';
import { AIContextBuilder } from './ai-context.builder';

/** @deprecated Prefer AIContextBuilder — kept for backward-compatible callers. */
@Injectable()
export class AIUserContextService {
  constructor(@Inject(AIContextBuilder) private readonly builder: AIContextBuilder) {}

  async build(userId: string): Promise<AIUserContext> {
    const snapshot = await this.builder.buildSnapshot(userId);
    return this.toLegacyContext(snapshot);
  }

  async buildSnapshot(userId: string): Promise<AIConversationContext> {
    return this.builder.buildSnapshot(userId);
  }

  async buildSummary(userId: string): Promise<ContextSnapshotSummary> {
    const snapshot = await this.builder.buildSnapshot(userId);
    return {
      userId: snapshot.userId,
      generatedAt: snapshot.generatedAt,
      dataVersion: snapshot.dataVersion,
      flags: snapshot.flags,
      ui: toContextUiLabels(snapshot.flags),
    };
  }

  private toLegacyContext(snapshot: AIConversationContext): AIUserContext {
    return {
      profile: snapshot.data.profile,
      goal: snapshot.data.goal,
      mealPlan: snapshot.data.mealPlan,
      progress: snapshot.data.progress,
      shopping: snapshot.data.shopping,
      prices: snapshot.data.priceIntelligence,
    };
  }
}
