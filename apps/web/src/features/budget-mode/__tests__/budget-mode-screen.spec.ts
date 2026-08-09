import { describe, expect, it } from 'vitest';
import type { BudgetMode } from '../model/budget-mode.types';

describe('budget mode screen contract', () => {
  it('supports the documented preference modes', () => {
    const modes: BudgetMode[] = ['frugal', 'balanced', 'flexible'];
    expect(modes).toHaveLength(3);
  });
});
