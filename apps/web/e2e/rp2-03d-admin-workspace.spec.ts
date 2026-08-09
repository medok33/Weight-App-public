import { expect, test } from '@playwright/test';

const OWNER_USER = process.env.OWNER_E2E_USERNAME ?? '';
const OWNER_PASS = process.env.OWNER_E2E_PASSWORD ?? '';

async function ownerLogin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(OWNER_USER);
  await page.getByTestId('auth-password').fill(OWNER_PASS);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
  await expect(page.getByTestId('auth-role-badge')).toContainText('OWNER', { timeout: 30_000 });
}

test.describe('RP2-03D STEP_212 admin workspace', () => {
  test.skip(!OWNER_USER || !OWNER_PASS, 'OWNER_E2E_* required');

  test('A/G admin workspace separation and production recipe filter', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('nav-admin-entry')).toBeVisible();
    await expect(page.getByTestId('nav-admin-recipes')).toHaveCount(0);

    await page.getByTestId('nav-admin-entry').click();
    await expect(page.getByTestId('admin-navigation')).toBeVisible();
    await expect(page.getByTestId('nav-admin-content')).toBeVisible();
    await expect(page.getByTestId('nav-back-to-app')).toBeVisible();
    await expect(page.getByTestId('nav-today')).toHaveCount(0);

    await page.getByTestId('nav-admin-recipes').click();
    await expect(page.getByTestId('admin-recipes-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('recipe-data-class-filter')).toContainText('PRODUCTION');
    const names = await page.locator('[data-testid="admin-recipes-grid"] tbody tr td:first-child').allTextContents();
    expect(names.some((n) => /Cust Dish|Historical Dish/i.test(n))).toBeFalsy();

    await page.getByTestId('recipe-data-class-select').selectOption('TEST_ONLY,HISTORICAL_ONLY,FIXTURE,LEGACY');
    await expect(page.getByTestId('recipe-data-class-filter')).toContainText('TEST_ONLY', { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('recipe-data-class-filter')).toContainText('TEST_ONLY');
  });

  test('B recipe detail allowed actions and technical snapshot', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/recipes?dataClass=PRODUCTION');
    await expect(page.getByTestId('admin-recipes-list')).toBeVisible({ timeout: 30_000 });
    const first = page.locator('[data-testid="admin-recipes-grid"] tbody tr a').first();
    test.skip((await first.count()) === 0, 'no production recipes');
    await first.click();
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('recipe-workspace-title')).not.toHaveText(/[0-9a-f-]{36}/i);
    await page.getByRole('button', { name: 'Lifecycle' }).click();
    await expect(page.getByTestId('lifecycle-actions')).toBeVisible();
    const actionCount = await page.locator('[data-testid="lifecycle-actions"] button').count();
    expect(actionCount).toBeLessThanOrEqual(3);
    await page.getByRole('button', { name: 'Technical' }).click();
    await expect(page.getByTestId('recipe-technical-snapshot')).toBeVisible();
    await expect(page.getByTestId('recipe-technical-snapshot')).not.toHaveAttribute('open', '');
    await page.locator('[data-testid="recipe-technical-snapshot"] summary').click();
    await expect(page.locator('[data-testid="recipe-technical-snapshot"] pre')).toBeVisible();
  });

  test('D coverage board shows slots and preserves filters', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/recipe-coverage');
    await expect(page.getByTestId('recipe-coverage-board')).toBeVisible({ timeout: 30_000 });
    const summary = await page.getByTestId('coverage-summary').innerText();
    expect(summary).toMatch(/Всего слотов:\s*\d+/);
    await page.getByLabel('Статус').selectOption('EMPTY');
    await expect(page).toHaveURL(/status=EMPTY/);
    await page.reload();
    await expect(page.getByLabel('Статус')).toHaveValue('EMPTY');
  });

  test('H desktop width uses admin workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ownerLogin(page);
    await page.goto('/admin/content');
    await expect(page.getByTestId('admin-content-overview')).toBeVisible({ timeout: 30_000 });
    const width = await page.locator('.admin-workspace').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(700);
  });
});
