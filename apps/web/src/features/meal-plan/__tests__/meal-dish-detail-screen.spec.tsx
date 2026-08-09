import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('meal dish detail screen', () => {
  it('renders detail route and disabled replace control', () => {
    const screen = readFileSync(
      resolve(process.cwd(), 'src/features/meal-plan/components/meal-dish-detail-screen.tsx'),
      'utf8',
    );
    expect(screen).toContain('meal-dish-detail');
    expect(screen).toContain('meal-dish-replace');
    expect(screen).toContain('disabled');
  });

  it('meal plan screen shows day cards and substitution panel', () => {
    const screen = readFileSync(
      resolve(process.cwd(), 'src/features/meal-plan/components/meal-plan-screen.tsx'),
      'utf8',
    );
    expect(screen).toContain('meal-day-detail');
    expect(screen).toContain('meal-card-details-');
    expect(screen).toContain('MealSubstitutionPanel');
  });
});
