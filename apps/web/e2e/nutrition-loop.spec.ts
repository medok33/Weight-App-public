import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const password = 'Password12345';

async function registerAndOnboard(page: Page, email: string, name: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/onboarding');
  await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('profile-name').fill(name);
  await page.getByTestId('profile-age').fill('31');
  await page.getByTestId('profile-height').fill('178');
  await page.getByTestId('profile-weight').fill('86');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('78');
  await page.getByTestId('profile-activity').selectOption('moderate');
  const regenerate = page.waitForResponse(
    (res) =>
      res.url().includes('/meal-plan/regenerate') &&
      res.request().method() === 'POST' &&
      res.ok(),
    { timeout: 90000 },
  );
  await page.getByTestId('profile-save').click();
  await regenerate;
  await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 30000 });
  await page.screenshot({ path: resolve(screenshotsDir, '10-onboarding-food-loop.png'), fullPage: true });
}

test('nutrition loop: onboarding → meal complete → dashboard → progress', async ({ page }) => {
  const stamp = Date.now();
  const name = `Food Loop ${stamp}`;
  const email = `food-${stamp}@test.com`;
  await registerAndOnboard(page, email, name);

  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-plan-targets')).toContainText(/цель|target|ккал|kcal/i);
  const complete = page.getByTestId('meal-complete-0').or(page.locator('[data-testid^="meal-complete-"]').first());
  await expect(complete).toBeVisible({ timeout: 20000 });
  await complete.click();
  await expect(complete).toBeChecked();
  await page.screenshot({ path: resolve(screenshotsDir, '11-meal-completed.png'), fullPage: true });

  await page.goto('/dashboard-today');
  await expect(page.getByTestId('nutrition-consumed').or(page.getByTestId('dashboard-card-nutrition'))).toBeVisible({
    timeout: 20000,
  });
  await page.screenshot({ path: resolve(screenshotsDir, '12-dashboard-after-meal.png'), fullPage: true });

  await page.reload();
  await expect(page.getByTestId('dashboard-heading').or(page.getByRole('heading', { name: /Сегодня|Today/i }))).toBeVisible({
    timeout: 20000,
  });
  await page.screenshot({ path: resolve(screenshotsDir, '13-dashboard-reloaded.png'), fullPage: true });

  await page.goto('/meal-plan');
  await expect(page.locator('[data-testid^="meal-complete-"]').first()).toBeChecked();
  await page.screenshot({ path: resolve(screenshotsDir, '14-meal-plan-persisted.png'), fullPage: true });

  await page.goto('/progress');
  await page.getByTestId('progress-weight').fill('85.4');
  await page.getByTestId('progress-save').click();
  await expect(page.getByTestId('progress-latest')).toContainText('85.4');
  await expect(page.getByTestId('progress-chart')).toBeVisible();
  await page.screenshot({ path: resolve(screenshotsDir, '15-progress-weight.png'), fullPage: true });

  await page.reload();
  await expect(page.getByTestId('progress-latest')).toContainText('85.4');
  await page.screenshot({ path: resolve(screenshotsDir, '16-progress-reloaded.png'), fullPage: true });
});
