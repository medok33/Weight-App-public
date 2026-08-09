import { Inject, Injectable } from '@nestjs/common';
import { filterChatIntent } from '../domain/ai-intent.policy';
import type { AIMetricsSummary } from '../domain/ai-feedback.types';
import { AIAssistantRepository } from '../infrastructure/ai-assistant.repository';

@Injectable()
export class AIMetricsService {
  constructor(@Inject(AIAssistantRepository) private readonly repository: AIAssistantRepository) {}

  async getSummary(userId?: string): Promise<AIMetricsSummary> {
    const [usage, ratings, recentUserMessages] = await Promise.all([
      this.repository.getUsageMetrics(userId),
      this.repository.getFeedbackMetrics(userId),
      this.repository.getRecentUserMessages(userId, 200),
    ]);

    const topicCounts = new Map<string, number>();
    for (const content of recentUserMessages) {
      const topic = filterChatIntent(content).topic;
      if (topic === 'OFFTOPIC' || topic === 'CLARIFY' || topic === 'GREETING') continue;
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }

    const popularTopics = [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      requestCount: usage.requestCount,
      thumbsUp: ratings.thumbsUp,
      thumbsDown: ratings.thumbsDown,
      errorCount: usage.errorCount,
      popularTopics,
    };
  }
}
