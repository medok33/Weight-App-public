import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const password = 'Password12345';

async function registerAndOnboard(page: Page, email: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/onboarding');
  await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('profile-name').fill('Browser MVP');
  await page.getByTestId('profile-age').fill('29');
  await page.getByTestId('profile-height').fill('176');
  await page.getByTestId('profile-weight').fill('84');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('76');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.screenshot({ path: resolve(screenshotsDir, '01-onboarding-filled.png'), fullPage: true });

  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 90000 });
  await page.screenshot({ path: resolve(screenshotsDir, '02-onboarding-saved.png'), fullPage: true });
}

test('MVP flow: bootstrap → onboarding → profile/goal save → dashboard', async ({ page }) => {
  const email = `mvp-${Date.now()}@test.com`;
  await registerAndOnboard(page, email);

  await page.reload();
  await expect(page.getByTestId('profile-name')).toHaveValue('Browser MVP');
  await expect(page.getByTestId('profile-age')).toHaveValue('29');
  await expect(page.getByTestId('profile-weight')).toHaveValue('84');
  await expect(page.getByTestId('profile-goal-target')).toHaveValue('76');
  await page.screenshot({ path: resolve(screenshotsDir, '03-onboarding-reloaded.png'), fullPage: true });

  await page.goto('/dashboard-today');
  await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('dashboard-card-nutrition')).toBeVisible();
  await page.screenshot({ path: resolve(screenshotsDir, '04-dashboard-today.png'), fullPage: true });

  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-heading').or(page.getByTestId('meal-plan-heading'))).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId('meal-plan-targets')).toContainText(/ккал|kcal|цель|target/i);
  await page.screenshot({ path: resolve(screenshotsDir, '05-meal-plan.png'), fullPage: true });

  await page.goto('/workout-engine');
  await expect(page.getByRole('heading', { name: /Workout|Трениров/i })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Day 1:|День 1/i)).toBeVisible();
  await page.screenshot({ path: resolve(screenshotsDir, '06-workout-engine.png'), fullPage: true });
});
