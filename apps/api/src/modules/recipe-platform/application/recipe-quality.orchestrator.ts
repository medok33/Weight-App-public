import { Injectable } from '@nestjs/common';
import { validateCulinaryCriticResult, type CulinaryCriticResult } from '../domain/culinary-critic.policy';
import { validateCanonicalContract, validateRecipeEditorSemanticCoverage, validateRecipeEditorText, type MethodSkeletonStep, type RecipeContractV1, type RecipeEditorSemanticCoverage } from '../domain/recipe-contract.v1';
import { issueVerifiedQualityReceipt, type RecipeQualityReceipt } from '../domain/recipe-quality.receipt';

export const MAX_RECIPE_EDITOR_ATTEMPTS = 2 as const;
export type RecipeEditorAttempt = (input: { skeleton: MethodSkeletonStep[]; attempt: number }) => Promise<unknown>;
export type CulinaryCriticAttempt = (input: { contract: RecipeContractV1 }) => Promise<unknown>;

@Injectable()
export class RecipeQualityOrchestrator {
  async verify(input: { base: Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'>; editor: RecipeEditorAttempt; critic: CulinaryCriticAttempt; deterministicValid?: boolean; semanticCoverage: RecipeEditorSemanticCoverage }): Promise<{ status: 'AUTO_VERIFIED' | 'REJECT'; attempts: number; contract?: RecipeContractV1; critic?: CulinaryCriticResult; receipt?: RecipeQualityReceipt; reasons: string[] }> {
    if (input.deterministicValid === false) return { status: 'REJECT', attempts: 0, reasons: ['DETERMINISTIC_HARD_FAIL'] };
    for (let attempt = 1; attempt <= MAX_RECIPE_EDITOR_ATTEMPTS; attempt += 1) {
      let renderedSteps;
      try { renderedSteps = validateRecipeEditorText(await input.editor({ skeleton: input.base.methodSkeleton, attempt }), input.base.methodSkeleton); } catch (error) {
        if (attempt === MAX_RECIPE_EDITOR_ATTEMPTS) return { status: 'REJECT', attempts: attempt, reasons: [error instanceof Error ? error.message : 'EDITOR_SCHEMA_INVALID'] };
        continue;
      }
      const contract = { ...input.base, renderedSteps, qualityStatus: 'STRUCTURED_CANDIDATE' as const };
      try { validateRecipeEditorSemanticCoverage(renderedSteps, input.semanticCoverage); validateCanonicalContract(contract); } catch (error) { return { status: 'REJECT', attempts: attempt, contract, reasons: [error instanceof Error ? error.message : 'CONTRACT_INVALID'] }; }
      const critic = validateCulinaryCriticResult(await input.critic({ contract }));
      if (critic.verdict === 'PASS') { const verifiedContract = { ...contract, qualityStatus: 'AUTO_VERIFIED' as const }; return { status: 'AUTO_VERIFIED', attempts: attempt, contract: verifiedContract, critic, receipt: issueVerifiedQualityReceipt({ contract: verifiedContract, critic }), reasons: [] }; }
      if (critic.verdict === 'REJECT' || attempt === MAX_RECIPE_EDITOR_ATTEMPTS) return { status: 'REJECT', attempts: attempt, contract, critic, reasons: critic.issues.map((issue) => issue.code) };
    }
    return { status: 'REJECT', attempts: MAX_RECIPE_EDITOR_ATTEMPTS, reasons: ['RETRY_EXHAUSTED'] };
  }
}
