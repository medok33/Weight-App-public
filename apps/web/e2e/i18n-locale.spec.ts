import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });

test('i18n: default RU → switch EN → reload persists EN', async ({ page }) => {
  const stamp = Date.now();
  const name = `Locale User ${stamp}`;

  await page.goto('/settings');
  await expect(page.getByTestId('nav-today')).toHaveText('Сегодня');
  await expect(page.getByTestId('profile-heading')).toHaveText('Профиль и цель');
  await page.screenshot({ path: resolve(screenshotsDir, '30-i18n-default-ru.png'), fullPage: true });

  await page.getByTestId('profile-name').fill(name);
  await page.getByTestId('profile-age').fill('30');
  await page.getByTestId('profile-height').fill('175');
  await page.getByTestId('profile-weight').fill('80');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('72');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.getByTestId('profile-locale').selectOption('en');
  await expect(page.getByTestId('nav-today')).toHaveText('Today');
  await expect(page.getByTestId('profile-heading')).toHaveText('Profile and goal');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText('Profile saved');
  await page.screenshot({ path: resolve(screenshotsDir, '31-i18n-switched-en.png'), fullPage: true });

  await page.reload();
  await expect(page.getByTestId('nav-today')).toHaveText('Today');
  await expect(page.getByTestId('nav-settings')).toHaveText('Settings');
  await expect(page.getByTestId('profile-heading')).toHaveText('Profile and goal');
  await expect(page.getByTestId('profile-locale')).toHaveValue('en');
  await page.screenshot({ path: resolve(screenshotsDir, '32-i18n-reload-en.png'), fullPage: true });

  await page.goto('/dashboard-today');
  await expect(page.getByTestId('dashboard-heading')).toHaveText('Today');
  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-heading')).toHaveText('Meal plan');
  await page.goto('/workout-engine');
  await expect(page.getByTestId('workout-heading')).toHaveText('Workout plan');
  await page.goto('/progress');
  await expect(page.getByTestId('progress-heading')).toHaveText('Progress');
  await page.goto('/shopping-list');
  await expect(page.getByTestId('shopping-heading')).toHaveText('Shopping');
  await page.screenshot({ path: resolve(screenshotsDir, '33-i18n-screens-en.png'), fullPage: true });
});
