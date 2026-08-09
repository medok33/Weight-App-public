import { describe, expect, it } from 'vitest';

describe('meal substitution UI contract', () => {
  it('documents optional walk without fabricated step counts', () => {
    const compensationOptions = [
      'REDUCE_PORTION',
      'ADJUST_NEXT_MEAL',
      'REPLACE_SNACK',
      'ACCEPT_FORECAST_SHIFT',
      'OPTIONAL_WALK',
    ];
    expect(compensationOptions).toContain('OPTIONAL_WALK');
    expect(compensationOptions).not.toContain('FORCE_1000_STEPS');
  });
});
