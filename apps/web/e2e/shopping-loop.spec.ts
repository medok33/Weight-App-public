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
  await page.getByTestId('profile-age').fill('33');
  await page.getByTestId('profile-height').fill('180');
  await page.getByTestId('profile-weight').fill('88');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('80');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 90000 });
}

test('shopping loop: meal plan → generate list → mark purchased → reload', async ({ page }) => {
  const stamp = Date.now();
  const name = `Shop Loop ${stamp}`;
  const email = `shop-${stamp}@test.com`;
  await registerAndOnboard(page, email, name);

  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-plan-targets')).toContainText(/цель|target|ккал|kcal/i);
  await page.screenshot({ path: resolve(screenshotsDir, '20-meal-plan-before-shop.png'), fullPage: true });

  await page.goto('/shopping-list');
  await page.getByTestId('shopping-generate').click();
  await expect(page.getByTestId('shopping-total')).toContainText(/Корзина|Basket|Total/i);
  await expect(page.getByTestId('shopping-items').locator('li').first()).toBeVisible();
  await page.screenshot({ path: resolve(screenshotsDir, '21-shopping-generated.png'), fullPage: true });

  const firstCheckbox = page.locator('[data-testid^="shopping-purchase-"]').first();
  await firstCheckbox.click();
  await expect(firstCheckbox).toBeChecked();
  await page.screenshot({ path: resolve(screenshotsDir, '22-shopping-purchased.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('[data-testid^="shopping-purchase-"]').first()).toBeChecked();
  await expect(page.getByTestId('shopping-total')).toContainText(/Корзина|Basket|Total/i);
  await page.screenshot({ path: resolve(screenshotsDir, '23-shopping-reloaded.png'), fullPage: true });

  await page.goto('/dashboard-today');
  await expect(page.getByTestId('budget-week')).not.toHaveText(/Стоимость недели: 0 |Week cost: 0 /);
  await expect(page.getByTestId('budget-today')).toContainText(/Стоимость сегодня|Today cost/i);
  await page.screenshot({ path: resolve(screenshotsDir, '24-dashboard-budget.png'), fullPage: true });
});
