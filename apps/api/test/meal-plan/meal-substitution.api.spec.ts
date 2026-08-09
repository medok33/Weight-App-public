import { describe, expect, it } from 'vitest';
import { classifySubstitution } from '../../src/modules/meal-plan/domain/substitution.classify';

describe('STEP_093 substitution API contract', () => {
  it('exposes compensation options without fabricated step punishment', () => {
    const result = classifySubstitution({
      source: { calories: 400, proteinG: 30, fatG: 10, carbsG: 40 },
      candidate: { calories: 720, proteinG: 22, fatG: 28, carbsG: 90 },
      requiresOtherMealAdjust: false,
    });
    expect(result.classification).toBe('CONFLICTING');
    expect(result.compensationOptions).toContain('OPTIONAL_WALK');
    expect(result.warnings[0]).toMatch(/расчётный срок может сдвинуться/i);
  });
});
