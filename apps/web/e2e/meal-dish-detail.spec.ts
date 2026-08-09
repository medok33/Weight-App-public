import { expect, test, type Page } from '@playwright/test';

const password = 'Password12345';

async function registerAndOnboard(page: Page, email: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/onboarding');
  await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('profile-name').fill('Dish Detail');
  await page.getByTestId('profile-age').fill('30');
  await page.getByTestId('profile-height').fill('175');
  await page.getByTestId('profile-weight').fill('80');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('75');
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
}

test.describe('STEP_092 meal dish detail', () => {
  test('desktop: day cards and dish details', async ({ page }) => {
    const email = `dish-desk-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('meal-day-tab-0').click();
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('meal-day-planned')).toBeVisible();
    await expect(page.getByTestId('meal-plan-version')).toBeVisible();

    const detailsLink = page.locator('[data-testid^="meal-card-details-"]').first();
    await expect(detailsLink).toBeVisible();
    await detailsLink.click();
    await expect(page.getByTestId('meal-dish-detail')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('meal-dish-ingredients')).toBeVisible();
    await expect(page.getByTestId('meal-dish-steps')).toBeVisible();
    await expect(page.getByTestId('meal-dish-macros')).toBeVisible();
    await expect(page.getByTestId('meal-dish-cost-consumed')).toBeVisible();

    const macros = (await page.getByTestId('meal-dish-macros').textContent()) ?? '';
    expect(macros).toMatch(/\d/);
    expect(macros.toLowerCase()).toMatch(/ккал|kcal|б|ж|у|protein|fat|carb/i);

    await page.getByTestId('meal-dish-back').click();
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid^="meal-card-details-"]').first()).toBeVisible();
    // Historical meal plan remains readable after reload.
    await expect(page.getByTestId('meal-plan-version')).toBeVisible();
  });

  test('mobile viewport: cards remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `dish-mob-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 20000 });
    const card = page.locator('[data-testid^="meal-card-"]').first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    expect(box?.width ?? 0).toBeLessThanOrEqual(390);
    await page.locator('[data-testid^="meal-card-details-"]').first().click();
    await expect(page.getByTestId('meal-dish-steps')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('meal-dish-macros')).toBeVisible();
    await expect(page.getByTestId('meal-dish-back')).toBeVisible();
  });
});
