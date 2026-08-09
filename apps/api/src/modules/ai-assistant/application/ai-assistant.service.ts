import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthRepository } from '../../auth/infrastructure/auth.repository';
import type { AIProviderAdapter } from '../domain/ai-provider.interface';
import { renderPrompt } from '../domain/ai-assistant.policy';
import type { AIQuota, PromptVersion } from '../domain/ai-assistant.types';
import { AIAssistantRepository } from '../infrastructure/ai-assistant.repository';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

@Injectable()
export class AIAssistantService {
  constructor(
    @Inject(AIAssistantRepository) private readonly repository: AIAssistantRepository,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
    @Optional() @Inject(AI_PROVIDER) private readonly provider?: AIProviderAdapter,
  ) {}

  async complete(prompt: PromptVersion, data: Record<string, unknown>, quota?: AIQuota) {
    if (quota && (quota.tokens > quota.maxTokens || quota.cost > quota.maxCost)) throw new Error('AI_QUOTA_EXCEEDED');
    if (!(await this.repository.control()).enabled) throw new Error('AI_KILL_SWITCH_ACTIVE');
    if (!this.provider) throw new Error('AI_PROVIDER_UNAVAILABLE');
    const result = await this.provider.complete({
      messages: [{ role: 'user', content: renderPrompt(prompt, data) }],
    });
    return result.content;
  }

  async control() {
    return this.repository.control();
  }

  private async ownerSession(token: string | undefined) {
    if (!token) throw new Error('OWNER_ACCESS_FORBIDDEN');
    const session = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!session || String(session.role).toUpperCase() !== 'OWNER') {
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    return session;
  }

  async controlByToken(token: string | undefined) {
    await this.ownerSession(token);
    return this.repository.control();
  }

  async setControlByToken(token: string | undefined, enabled: boolean) {
    const session = await this.ownerSession(token);
    return this.repository.setControl(session.userId, enabled);
  }

  async requireOwnerByToken(token: string | undefined) {
    return this.ownerSession(token);
  }

  async setSubscriptionByToken(token: string | undefined, targetUserId: string, tier: 'FREE' | 'PREMIUM') {
    await this.ownerSession(token);
    await this.authRepository.setSubscriptionTier(targetUserId, tier);
  }
}
