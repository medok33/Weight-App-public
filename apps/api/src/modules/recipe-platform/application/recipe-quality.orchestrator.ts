import { Injectable } from '@nestjs/common';
import { validateCulinaryCriticResult, type CulinaryCriticResult } from '../domain/culinary-critic.policy';
import { validateCanonicalContract, validateRecipeEditorText, type MethodSkeletonStep, type RecipeContractV1 } from '../domain/recipe-contract.v1';

export const MAX_RECIPE_EDITOR_ATTEMPTS = 2 as const;
export type RecipeEditorAttempt = (input: { skeleton: MethodSkeletonStep[]; attempt: number }) => Promise<unknown>;
export type CulinaryCriticAttempt = (input: { contract: RecipeContractV1 }) => Promise<unknown>;

@Injectable()
export class RecipeQualityOrchestrator {
  async verify(input: { base: Omit<RecipeContractV1, 'renderedSteps' | 'qualityStatus'>; editor: RecipeEditorAttempt; critic: CulinaryCriticAttempt; deterministicValid?: boolean }): Promise<{ status: 'AUTO_VERIFIED' | 'REJECT'; attempts: number; contract?: RecipeContractV1; critic?: CulinaryCriticResult; reasons: string[] }> {
    if (input.deterministicValid === false) return { status: 'REJECT', attempts: 0, reasons: ['DETERMINISTIC_HARD_FAIL'] };
    for (let attempt = 1; attempt <= MAX_RECIPE_EDITOR_ATTEMPTS; attempt += 1) {
      let renderedSteps;
      try { renderedSteps = validateRecipeEditorText(await input.editor({ skeleton: input.base.methodSkeleton, attempt }), input.base.methodSkeleton); } catch (error) {
        if (attempt === MAX_RECIPE_EDITOR_ATTEMPTS) return { status: 'REJECT', attempts: attempt, reasons: [error instanceof Error ? error.message : 'EDITOR_SCHEMA_INVALID'] };
        continue;
      }
      const contract = { ...input.base, renderedSteps, qualityStatus: 'STRUCTURED_CANDIDATE' as const };
      try { validateCanonicalContract(contract); } catch (error) { return { status: 'REJECT', attempts: attempt, reasons: [error instanceof Error ? error.message : 'CONTRACT_INVALID'] }; }
      const critic = validateCulinaryCriticResult(await input.critic({ contract }));
      if (critic.verdict === 'PASS') return { status: 'AUTO_VERIFIED', attempts: attempt, contract: { ...contract, qualityStatus: 'AUTO_VERIFIED' }, critic, reasons: [] };
      if (critic.verdict === 'REJECT' || attempt === MAX_RECIPE_EDITOR_ATTEMPTS) return { status: 'REJECT', attempts: attempt, contract, critic, reasons: critic.issues.map((issue) => issue.code) };
    }
    return { status: 'REJECT', attempts: MAX_RECIPE_EDITOR_ATTEMPTS, reasons: ['RETRY_EXHAUSTED'] };
  }
}
