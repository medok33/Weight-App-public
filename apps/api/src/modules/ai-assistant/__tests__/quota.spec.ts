import { describe, expect, it, vi } from 'vitest';
import { AIAssistantService } from '../application/ai-assistant.service';
import { LocalProvider } from '../providers/local.provider';
import type { AIAssistantRepository } from '../infrastructure/ai-assistant.repository';

describe('AI quota', () => {
  it('rejects limits', async () => {
    const repo = {
      control: vi.fn(async () => ({ enabled: true, updatedAt: new Date().toISOString() })),
    } as unknown as AIAssistantRepository;
    const service = new AIAssistantService(repo, new LocalProvider());
    await expect(
      service.complete({ intent: 'habit_coach', version: 'v1', template: 'x' }, {}, { tokens: 2, cost: 0, maxTokens: 1, maxCost: 1 }),
    ).rejects.toThrow('AI_QUOTA_EXCEEDED');
  });
});
