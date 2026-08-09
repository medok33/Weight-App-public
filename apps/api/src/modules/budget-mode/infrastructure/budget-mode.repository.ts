import { Injectable } from '@nestjs/common';
import type { BudgetModePreferences } from '../domain/budget-mode.types';

/** MVP preference store. It is intentionally not a source of price truth. */
@Injectable()
export class BudgetModeRepository {
  private readonly preferences = new Map<string, BudgetModePreferences>();

  get(userId: string): BudgetModePreferences {
    return this.preferences.get(userId) ?? { mode: 'balanced' };
  }

  set(userId: string, value: BudgetModePreferences): BudgetModePreferences {
    this.preferences.set(userId, value);
    return value;
  }
}
