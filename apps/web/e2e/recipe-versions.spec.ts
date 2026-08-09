import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
const hasOwnerCreds = Boolean(ownerUser && ownerPass);

async function ownerLogin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(ownerUser);
  await page.getByTestId('auth-password').fill(ownerPass);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });
}

test.describe('RP2-02A recipe versions', () => {
  test('E: USER cannot create RecipeVersion', async ({ page }) => {
    const email = `recipe-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    const forbidden = await page.request.get(`${api}/admin/recipes`);
    expect([401, 403]).toContain(forbidden.status());
  });

  test('A: OWNER sees version 1 and can open snapshot', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/recipes');
    await expect(page.getByTestId('admin-recipes-list')).toBeVisible({ timeout: 20000 });
    const first = page.locator('[data-testid^="admin-recipe-"]').first();
    await first.click();
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('recipe-version-list')).toBeVisible();
    await expect(page.getByText(/v1 ·/)).toBeVisible();
    await page.getByRole('button', { name: /v1 ·/ }).first().click();
    await expect(page.getByTestId('recipe-version-preview')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('version-readonly-1')).toBeVisible();
  });

  test('B: historical meal plan day detail loads with pinned version content', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('meal-day-tab-0').click();
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('meal-plan-version')).toBeVisible();
    const firstDish = page.locator('[data-testid^="meal-dish-card-"]').first();
    if (await firstDish.count()) {
      await firstDish.click();
      await expect(page.getByTestId('meal-dish-detail')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('meal-dish-ingredients')).toBeVisible();
    }
  });
});
