import { Inject, Injectable } from '@nestjs/common';
import { AuthRepository } from '../../auth/infrastructure/auth.repository';
import { AIAssistantRepository } from '../infrastructure/ai-assistant.repository';
import {
  getTariffConfig,
  toQuotaView,
  type AITariffConfig,
  type AITariffTier,
  type QuotaView,
} from '../domain/ai-tariff.types';

export type DailyUsageSummary = {
  userId: string;
  date: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  models: string[];
};

@Injectable()
export class AITariffService {
  constructor(
    @Inject(AIAssistantRepository) private readonly repository: AIAssistantRepository,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
  ) {}

  async isOwner(userId: string): Promise<boolean> {
    const role = await this.authRepository.getAccountRole(userId);
    return role === 'OWNER';
  }

  async resolveTier(userId: string): Promise<AITariffTier> {
    if (await this.isOwner(userId)) return 'PREMIUM';
    const subscription = await this.authRepository.getSubscription(userId);
    if (subscription?.tier === 'PREMIUM') return 'PREMIUM';
    if (await this.repository.hasPremiumEntitlement(userId)) return 'PREMIUM';
    return 'FREE';
  }

  async resolveTariff(userId: string): Promise<AITariffConfig> {
    if (await this.isOwner(userId)) {
      return getTariffConfig('PREMIUM', { ownerUnlimited: true });
    }
    return getTariffConfig(await this.resolveTier(userId));
  }

  async getDailyUsage(userId: string, day = new Date()): Promise<DailyUsageSummary> {
    return this.repository.getDailyUsage(userId, day);
  }

  async getQuotaView(userId: string): Promise<QuotaView & { tariff: AITariffTier; model: string; thinking: string }> {
    const tariff = await this.resolveTariff(userId);
    const usage = await this.getDailyUsage(userId);
    return {
      ...toQuotaView(tariff, usage.requestCount),
      tariff: tariff.tier,
      model: tariff.model,
      thinking: tariff.thinking,
    };
  }

  /**
   * OWNER never receives AI_DAILY_LIMIT_EXCEEDED.
   * LIMITED FREE/PREMIUM block after successful daily count reaches limit.
   */
  async assertWithinDailyLimit(userId: string, tariff: AITariffConfig): Promise<DailyUsageSummary> {
    const usage = await this.getDailyUsage(userId);
    if (tariff.quotaMode === 'UNLIMITED' || tariff.ownerUnlimited || tariff.dailyRequestLimit == null) {
      return usage;
    }
    if (usage.requestCount >= tariff.dailyRequestLimit) {
      throw new Error('AI_DAILY_LIMIT_EXCEEDED');
    }
    return usage;
  }
}
