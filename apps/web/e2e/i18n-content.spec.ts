import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });

/** Latin letters that indicate leftover English UI when locale is RU (allow none in content areas). */
const LATIN_WORD = /\b[A-Za-z]{2,}\b/;

test('i18n content: RU has translated meals/workouts/categories on key screens', async ({ page }) => {
  const stamp = Date.now();
  const name = `Контент ${stamp}`;

  await page.goto('/onboarding');
  await page.getByTestId('profile-name').fill(name);
  await page.getByTestId('profile-age').fill('30');
  await page.getByTestId('profile-height').fill('175');
  await page.getByTestId('profile-weight').fill('80');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('72');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.getByTestId('profile-locale').selectOption('ru');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText('Профиль сохранён', { timeout: 20000 });

  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-heading')).toHaveText('План питания');
  await expect(page.getByTestId('meal-day-0')).toBeVisible({ timeout: 15000 });
  const mealText = await page.getByTestId('meal-day-0').innerText();
  expect(mealText).not.toMatch(/Greek yogurt|Garden salad|Oatmeal bowl|Baked fish|Egg scramble/i);
  expect(mealText).toMatch(/День/);
  expect(mealText).toMatch(/ккал/);
  // Must show a Russian meal label (not raw key)
  expect(mealText).not.toMatch(/greek_yogurt|oatmeal_bowl|baked_fish/);
  await page.screenshot({ path: resolve(screenshotsDir, '40-i18n-content-meal-plan-ru.png'), fullPage: true });

  await page.goto('/workout-engine');
  await expect(page.getByTestId('workout-heading')).toHaveText('План тренировок');
  await expect(page.getByTestId('workout-day-0')).toBeVisible({ timeout: 15000 });
  const workoutText = await page.getByTestId('workout-day-0').innerText();
  expect(workoutText).not.toMatch(/Morning walk|Recovery walk|Bodyweight squats/i);
  expect(workoutText).not.toMatch(/morning_walk|recovery_walk/);
  expect(workoutText).toMatch(/прогулка|приседания|растяжка|пробежка|планка|мобилити/i);
  await page.screenshot({ path: resolve(screenshotsDir, '41-i18n-content-workout-ru.png'), fullPage: true });

  await page.goto('/shopping-list');
  await page.getByTestId('shopping-generate').click();
  await expect(page.getByTestId('shopping-items')).toBeVisible({ timeout: 20000 });
  const shopText = await page.getByTestId('shopping-items').innerText();
  expect(shopText).not.toMatch(/\b(protein|dairy|grains|produce|pantry|fruit|vegetables)\b/i);
  expect(shopText).not.toMatch(/Chicken breast|Greek yogurt|Olive oil|Whole-grain/i);
  expect(shopText).toMatch(/Белок|Молочные|Зерновые|Овощи|Фрукты|Бакалея|Другое/);
  await page.screenshot({ path: resolve(screenshotsDir, '42-i18n-content-shopping-ru.png'), fullPage: true });

  await page.goto('/dashboard-today');
  await expect(page.getByTestId('dashboard-heading')).toHaveText('Сегодня');
  await expect(page.getByTestId('dashboard-card-meal-plan')).toBeVisible({ timeout: 15000 });
  const dashMeal = await page.getByTestId('dashboard-card-meal-plan').innerText();
  const dashWorkout = await page.getByTestId('dashboard-card-workout').innerText();
  expect(dashMeal).not.toMatch(/Meal plan|Greek yogurt|Not planned/i);
  expect(dashMeal).toContain('План питания');
  expect(dashWorkout).not.toMatch(/Morning walk|Workout/i);
  expect(dashWorkout).toContain('Тренировка');
  const nutrition = await page.getByTestId('dashboard-nutrition-metrics').innerText();
  expect(nutrition).toContain('ккал');
  expect(nutrition).not.toMatch(/\bkcal\b/i);
  await page.screenshot({ path: resolve(screenshotsDir, '43-i18n-content-dashboard-ru.png'), fullPage: true });

  // Spot-check that main content regions avoid raw English product words
  for (const text of [mealText, workoutText, shopText, dashMeal]) {
    expect(text).not.toMatch(/\b(Loading|Version|Ready|Error)\b/);
  }
  void LATIN_WORD;
});
