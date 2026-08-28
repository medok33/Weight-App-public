import { Inject, Injectable } from '@nestjs/common';
import type { AIProviderAdapter } from '../../ai-assistant/domain/ai-provider.interface';
import { validateChefEditorInput, validateChefEditorOutput, type ChefEditorInput, type ChefEditorResult } from '../domain/recipe-authoring.policy';

export const CHEF_EDITOR_PROVIDER_DECISION = 'REUSE_EXISTING_AI_GATEWAY';
export const CHEF_EDITOR_PROVIDER_REASON = 'Existing AIProviderAdapter supports DeepSeek/OpenAI/local routing; ChefEditor adds a strict bounded contract around it.';
export const CHEF_EDITOR_PROVIDER = Symbol('CHEF_EDITOR_PROVIDER');

/** Deterministic provider used by tests and local authoring; no network and no paid calls. */
export class DeterministicChefEditorProvider implements Pick<AIProviderAdapter, 'providerId' | 'complete'> {
  readonly providerId = 'deterministic-test';
  async complete(): Promise<Awaited<ReturnType<AIProviderAdapter['complete']>>> { return { content: JSON.stringify({ contractVersion: 'chef-editor/v1', title: 'Авторское блюдо', description: 'Сбалансированное блюдо из утверждённого плана.', steps: [{ index: 1, text: 'Подготовьте ингредиенты и приготовьте до готовности.', ingredientIds: [] }], method: 'Приготовление по шагам.', presentation: 'Подайте порционно.', notes: [] }), providerId: this.providerId, model: 'deterministic', promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0, thinkingEnabled: false }; }
}

@Injectable()
export class ChefEditorService {
  private enabled = true;
  constructor(
    @Inject(CHEF_EDITOR_PROVIDER)
    private readonly provider: Pick<AIProviderAdapter, 'providerId' | 'complete'> = new DeterministicChefEditorProvider(),
  ) {}
  setKillSwitch(enabled: boolean) { this.enabled = enabled; }
  async author(input: ChefEditorInput, options: { timeoutMs?: number; maxAttempts?: number } = {}): Promise<ChefEditorResult> {
    const started = Date.now();
    try { validateChefEditorInput(input); } catch { return { status: 'POLICY_BLOCKED', audit: { provider: this.provider.providerId, attempts: 0, durationMs: Date.now() - started, contractVersion: 'none' } }; }
    if (!this.enabled) return { status: 'POLICY_BLOCKED', audit: { provider: this.provider.providerId, attempts: 0, durationMs: Date.now() - started, contractVersion: 'none' } };
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 3)); const timeoutMs = Math.max(50, Math.min(options.timeoutMs ?? 5000, 30000));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await Promise.race([this.provider.complete({ messages: [{ role: 'system', content: 'Return only the ChefEditor schema.' }, { role: 'user', content: JSON.stringify({ brief: input.brief, grammage: input.grammage, approvedProductIds: input.approvedProductIds }) }] }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))]);
        const output = validateChefEditorOutput(JSON.parse(response.content), input.grammage.map((i) => i.id));
        return { status: 'SUCCESS', output, audit: { provider: this.provider.providerId, attempts: attempt, durationMs: Date.now() - started, contractVersion: output.contractVersion } };
      } catch (error) { if (String((error as Error).message) === 'TIMEOUT') return { status: 'TIMEOUT', audit: { provider: this.provider.providerId, attempts: attempt, durationMs: Date.now() - started, contractVersion: 'none' } }; if (attempt === maxAttempts) return { status: 'SCHEMA_INVALID', audit: { provider: this.provider.providerId, attempts: attempt, durationMs: Date.now() - started, contractVersion: 'none' } }; }
    }
    return { status: 'PROVIDER_ERROR', audit: { provider: this.provider.providerId, attempts: maxAttempts, durationMs: Date.now() - started, contractVersion: 'none' } };
  }
}
