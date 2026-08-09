import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MealPlanService } from '../application/meal-plan.service';

const recipes = [
  { id: 'r1', name: 'Oats', calories: 300 },
  { id: 'r2', name: 'Salad', calories: 200, tags: ['nuts'] },
];

function service() {
  return new MealPlanService();
}

test('weekly plan selects deterministic candidates', async () => {
  const plan = await service().createWeekly('u1', recipes);
  assert.equal(plan.days.length, 7);
  assert.ok(plan.days[0].meals.length >= 4);
});

test('immutable versions advance', async () => {
  const mealPlanService = service();
  const plan = await mealPlanService.createWeekly('u1', recipes);
  const versioned = await mealPlanService.versioned('u1', plan);
  assert.equal(versioned.version, 2);
});

test('invalid plan is rejected', async () => {
  await assert.rejects(
    () => service().versioned('u1', { userId: 'u1', version: 1, days: [] }),
    /MEAL_PLAN_INVALID/,
  );
});

test('substitution, life mode and lifecycle are deterministic', async () => {
  const mealPlanService = service();
  const plan = await mealPlanService.createWeekly('u1', recipes);
  assert.equal(mealPlanService.substitute(recipes, [], 'r1')?.id, 'r2');
  assert.match(mealPlanService.adapt(plan, 'travel').days[0].meals[0].name, /^\[travel\]/);
  assert.equal(mealPlanService.transition('draft', 'generating'), 'generating');
  assert.throws(() => mealPlanService.transition('draft', 'completed'), /MEAL_PLAN_INVALID_TRANSITION/);
});

test('active plan summary maps meal names', async () => {
  const summary = await service().getSummary('u-summary');
  assert.ok(summary.days.length > 0);
  assert.equal(typeof summary.days[0]?.mealName, 'string');
});
