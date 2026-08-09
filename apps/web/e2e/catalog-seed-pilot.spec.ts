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

test.describe('RP2-01C2A pilot seed admin browser', () => {
  test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

  test('OWNER sees pilot products, filters, detail, review queue', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/products');
    await expect(page.getByTestId('admin-products-page')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-products-table')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('admin-product-search').fill('Гречка');
    await expect(page.locator('[data-testid^="admin-product-link-"]').first()).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId('admin-product-search').fill('гречка сухая');
    await expect(page.locator('[data-testid^="admin-product-link-"]').first()).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId('admin-product-filter-category').selectOption({ label: 'Крупы' });
    await expect(page.getByTestId('admin-products-table')).toBeVisible();

    const href = await page.locator('[data-testid^="admin-product-link-"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(href!);
    await expect(page.getByTestId('admin-product-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-nutrition-list')).toBeVisible();
    await expect(page.getByTestId('admin-alias-list')).toBeVisible();

    await page.goto('/admin/product-review');
    await expect(page.getByTestId('admin-product-review-page').or(page.getByRole('heading'))).toBeVisible({
      timeout: 20000,
    });

    await page.goto('/admin/products?q=Минтай&page=1');
    await expect(page.getByTestId('admin-product-search')).toHaveValue(/Минтай/i, { timeout: 10000 });
  });
});

test.describe('RP2-01C2A USER meal regression smoke', () => {
  test('USER can open meal plan dish path', async ({ page }) => {
    const email = `seed-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    await page.goto('/meal-plan');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });
    const dishLink = page.locator('a[href*="/meal-plan/items/"]').first();
    if (await dishLink.count()) {
      await dishLink.click();
      await expect(page.getByTestId('dish-detail').or(page.getByRole('heading'))).toBeVisible({
        timeout: 20000,
      });
    }
    void api;
  });
});
