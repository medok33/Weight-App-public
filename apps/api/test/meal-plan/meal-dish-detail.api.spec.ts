import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MealPlanController } from '../../src/modules/meal-plan/controllers/meal-plan.controller';

describe('STEP_092 meal dish detail API wiring', () => {
  it('exposes day and item detail routes on controller source', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/modules/meal-plan/controllers/meal-plan.controller.ts'),
      'utf8',
    );
    expect(source).toContain("Get('days/:dayIndex')");
    expect(source).toContain("Get('items/:itemId/details')");
    expect(MealPlanController.name).toBe('MealPlanController');
  });

  it('migration 169 adds RecipeStep and meal schedule columns', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/169_meal-dish-detail/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "RecipeStep"');
    expect(sql).toContain('"mealType"');
    expect(sql).toContain('"plannedTime"');
    expect(sql).toContain('"fatPer100g"');
  });
});
