import { createHash } from 'node:crypto';
import type { CulinaryCriticResult } from './culinary-critic.policy';

const RECEIPT_BRAND = Symbol('recipe-quality-receipt');

export type RecipeQualityReceipt = {
  readonly producer: 'RecipeQualityOrchestrator';
  readonly contractChecksum: string;
  readonly critic: CulinaryCriticResult;
  readonly deterministicValid: true;
  readonly [RECEIPT_BRAND]: true;
};

export function qualityContractChecksum(contract: unknown): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function issueVerifiedQualityReceipt(input: { contract: unknown; critic: CulinaryCriticResult }): RecipeQualityReceipt {
  if (input.critic.verdict !== 'PASS' || input.critic.issues.length > 0) throw new Error('QUALITY_RECEIPT_REQUIRES_CRITIC_PASS');
  return { producer: 'RecipeQualityOrchestrator', contractChecksum: qualityContractChecksum(input.contract), critic: input.critic, deterministicValid: true, [RECEIPT_BRAND]: true };
}

export function isVerifiedQualityReceipt(value: unknown): value is RecipeQualityReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<RecipeQualityReceipt>;
  return receipt.producer === 'RecipeQualityOrchestrator' && receipt.deterministicValid === true && receipt.critic?.verdict === 'PASS' && Array.isArray(receipt.critic.issues) && receipt[RECEIPT_BRAND] === true && typeof receipt.contractChecksum === 'string';
}
