import { Inject, Injectable } from '@nestjs/common';
import { optimizeCandidates, validatePreferences } from '../domain/budget-mode.policy';
import type { OptimizeInput } from '../domain/budget-mode.types';
import { BudgetModeRepository } from '../infrastructure/budget-mode.repository';

@Injectable()
export class BudgetModeService {
  constructor(@Inject(BudgetModeRepository) private readonly repository: BudgetModeRepository) {}

  get(userId: string) {
    if (!userId) throw new Error('BUDGET_MODE_FORBIDDEN');
    return this.repository.get(userId);
  }

  set(userId: string, input: { mode?: string }) {
    if (!userId) throw new Error('BUDGET_MODE_FORBIDDEN');
    return this.repository.set(userId, validatePreferences(input));
  }

  optimize(userId: string, input: OptimizeInput) {
    return optimizeCandidates(input.candidates, input.excludedTags ?? [], this.get(userId));
  }
}
