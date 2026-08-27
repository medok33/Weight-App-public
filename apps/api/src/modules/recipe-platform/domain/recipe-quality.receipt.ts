import { createHash } from 'node:crypto';
import type { CulinaryCriticResult } from './culinary-critic.policy';

export type RecipeQualityReceipt = {
  readonly producer: 'RecipeQualityOrchestrator';
  readonly contractChecksum: string;
  readonly critic: CulinaryCriticResult;
  readonly deterministicValid: true;
};

export function qualityContractChecksum(contract: unknown): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}
