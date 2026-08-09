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

test.describe('RP2-01C2B2 catalog-core-v3 admin', () => {
  test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

  test('OWNER browses final dataset and review queue', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/products');
    await expect(page.getByTestId('admin-products-page')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('admin-product-search').fill('Батат');
    const link = page.getByRole('link', { name: /Батат/i }).first();
    await expect(link).toBeVisible({ timeout: 15000 });
    await page.goto((await link.getAttribute('href'))!);
    await expect(page.getByTestId('admin-product-detail')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-product-dataset')).toContainText('catalog-core-v3');
    await expect(page.getByTestId('admin-nutrition-list')).toBeVisible();

    await page.goto('/admin/product-review');
    await expect(page.getByTestId('admin-product-review')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('admin-review-dataset').selectOption('catalog-core-v3');
    await expect(page.getByTestId('admin-review-list')).toBeVisible({ timeout: 15000 });

    const resolveBtn = page.locator('[data-testid^="admin-review-resolve-"]').first();
    if (await resolveBtn.count()) {
      await resolveBtn.click();
      await expect(page.getByRole('status')).toContainText(/Resolved/i, { timeout: 15000 });
      await page.reload();
      await expect(page.getByTestId('admin-product-review')).toBeVisible();
    }
  });
});
