import { expect, test } from '@playwright/test';

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

test.describe('RP2-01C2B1 catalog-core-v2 admin', () => {
  test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

  test('OWNER finds expanded products, review filters, resolves non-blocking', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/products');
    await expect(page.getByTestId('admin-products-page')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('admin-product-search').fill('Горбуша');
    const link = page.getByRole('link', { name: /Горбуша/i }).first();
    await expect(link).toBeVisible({ timeout: 15000 });
    const href = await link.getAttribute('href');
    await page.goto(href!);
    await expect(page.getByTestId('admin-product-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-product-dataset')).toContainText('catalog-core-v2');
    await expect(page.getByTestId('admin-nutrition-list')).toBeVisible();

    await page.goto('/admin/product-review');
    await expect(page.getByTestId('admin-product-review')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('admin-review-dataset').selectOption('catalog-core-v2');
    await expect(page.getByTestId('admin-review-list')).toBeVisible({ timeout: 15000 });

    const resolveBtn = page.locator('[data-testid^="admin-review-resolve-"]').first();
    if (await resolveBtn.count()) {
      await resolveBtn.click();
      await expect(page.getByRole('status')).toContainText(/Resolved/i, { timeout: 15000 });
      await page.reload();
      await expect(page.getByTestId('admin-product-review')).toBeVisible();
    }

    await page.goto('/admin/product-duplicates');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('RP2-01C2B1 USER regression smoke', () => {
  test('USER opens meal plan', async ({ page }) => {
    const email = `corev2-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });
    await page.goto('/meal-plan');
    await expect(
      page.getByTestId('meal-plan-heading').or(page.getByTestId('meal-plan-version')).or(page.getByRole('heading').first()),
    ).toBeVisible({ timeout: 45000 });
  });
});
