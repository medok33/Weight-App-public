import { Injectable } from '@nestjs/common';
import type { SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';
import type { RecipeContractV1, RecipeEditorSemanticCoverage } from '../domain/recipe-contract.v1';
import { RecipeQualityOrchestrator, type CulinaryCriticAttempt, type RecipeEditorAttempt } from './recipe-quality.orchestrator';
import { resolveSynthesisTarget } from '../domain/synthesis-target-contract';

export type BoundedSynthesisInput = {
  brief: SynthesisBrief;
  base: Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'>;
  hasCurrentApproval: (brief: SynthesisBrief) => Promise<boolean>;
  editor: RecipeEditorAttempt;
  critic: CulinaryCriticAttempt;
  publish: (contract: RecipeContractV1) => Promise<unknown>;
};

@Injectable()
export class BoundedSynthesisOrchestrator {
  constructor(private readonly quality: RecipeQualityOrchestrator) {}

  async synthesize(input: BoundedSynthesisInput): Promise<{ status: 'PUBLISHED' | 'REJECT'; target: string; editorCalls: number; criticCalls: number; publication?: unknown; reasons: string[] }> {
    const target = resolveSynthesisTarget(input.brief.clusterId);
    try {
      target.validateBrief(input.brief);
    } catch (error) {
      return { status: 'REJECT', target: target.label, editorCalls: 0, criticCalls: 0, reasons: [error instanceof Error ? error.message : 'SYNTHESIS_BRIEF_INVALID'] };
    }
    if (!(await input.hasCurrentApproval(input.brief))) return { status: 'REJECT', target: target.label, editorCalls: 0, criticCalls: 0, reasons: ['CURRENT_APPROVAL_REQUIRED'] };
    const approved = new Set(input.brief.approvedProducts);
    const actual = new Set(input.base.ingredients.map((ingredient) => ingredient.productId));
    if (actual.size !== approved.size || [...actual].some((productId) => !approved.has(productId))) return { status: 'REJECT', target: target.label, editorCalls: 0, criticCalls: 0, reasons: ['PRODUCT_SELECTION_DRIFT'] };
    if ((input.base.totalTimeMinutes ?? 0) > target.maxTotalTimeMinutes) return { status: 'REJECT', target: target.label, editorCalls: 0, criticCalls: 0, reasons: ['SYNTHESIS_TIME_LIMIT_EXCEEDED'] };
    const semanticCoverage: RecipeEditorSemanticCoverage = { requiredTerms: target.requiredTerms, forbiddenTerms: target.forbiddenTerms };
    const result = await this.quality.verify({ base: input.base, editor: input.editor, critic: input.critic, semanticCoverage });
    if (result.status !== 'AUTO_VERIFIED' || !result.contract || !result.receipt) return { status: 'REJECT', target: target.label, editorCalls: result.attempts, criticCalls: result.critic ? 1 : 0, reasons: result.reasons };
    return { status: 'PUBLISHED', target: target.label, editorCalls: result.attempts, criticCalls: 1, publication: await input.publish(result.contract), reasons: [] };
  }
}
