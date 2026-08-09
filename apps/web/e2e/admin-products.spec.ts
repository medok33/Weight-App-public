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

test.describe('STEP_200 admin product catalog', () => {
  test('F: USER cannot open admin products API', async ({ page }) => {
    const email = `admin-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    await expect(page.getByTestId('nav-admin-products')).toHaveCount(0);
    const forbidden = await page.request.get(`${api}/admin/products`);
    expect([401, 403]).toContain(forbidden.status());
    const mutate = await page.request.post(`${api}/admin/products`, {
      data: {
        canonicalName: 'x',
        productKey: 'x',
        categoryId: 'x',
        form: 'RAW',
        defaultUnit: 'g',
      },
    });
    expect([401, 403]).toContain(mutate.status());
  });

  test('A: OWNER edits product and persists after reload', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/products');
    await expect(page.getByTestId('admin-products-page')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-products-table')).toBeVisible({ timeout: 20000 });

    const firstLink = page.locator('[data-testid^="admin-product-link-"]').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(href!);
    await expect(page.getByTestId('admin-product-detail')).toBeVisible({ timeout: 20000 });

    const nameInput = page.getByTestId('admin-product-name');
    const current = await nameInput.inputValue();
    const next = current.endsWith(' ·adm') ? current.replace(/ ·adm$/, '') : `${current} ·adm`;
    await nameInput.fill(next);
    await page.getByTestId('admin-product-save').click();
    await expect(page.getByRole('status')).toContainText(/Saved/i, { timeout: 15000 });
    await page.reload();
    await expect(page.getByTestId('admin-product-name')).toHaveValue(next, { timeout: 20000 });
  });

  test('B: nutrition version append-only', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/products');
    const href = await page.locator('[data-testid^="admin-product-link-"]').first().getAttribute('href');
    await page.goto(href!);
    await expect(page.getByTestId('admin-product-detail')).toBeVisible({ timeout: 20000 });
    const beforeCount = await page.getByTestId('admin-nutrition-list').locator('li').count();
    await page.locator('[data-testid="admin-nutrition-form"] input').nth(0).fill('321');
    await page.locator('[data-testid="admin-nutrition-form"] input').nth(1).fill('22');
    await page.locator('[data-testid="admin-nutrition-form"] input').nth(2).fill('3');
    await page.locator('[data-testid="admin-nutrition-form"] input').nth(3).fill('40');
    await page.getByTestId('admin-nutrition-submit').click();
    await expect(page.getByTestId('admin-nutrition-list').locator('li')).toHaveCount(beforeCount + 1, {
      timeout: 15000,
    });
  });

  test('C: alias shows normalized value', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/products');
    const href = await page.locator('[data-testid^="admin-product-link-"]').first().getAttribute('href');
    await page.goto(href!);
    await page.getByTestId('admin-alias-input').fill(`Alias ${Date.now()}`);
    await page.getByTestId('admin-alias-submit').click();
    await expect(page.getByTestId('admin-alias-list')).toContainText(/Alias|alias/i, { timeout: 15000 });
  });

  test('G: merge preview returns structured result', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/products');
    const links = page.locator('[data-testid^="admin-product-link-"]');
    await expect(links.first()).toBeVisible({ timeout: 20000 });
    const hrefA = await links.nth(0).getAttribute('href');
    const hrefB = await links.nth(1).getAttribute('href');
    const idA = hrefA?.split('/').pop() ?? '';
    const idB = hrefB?.split('/').pop() ?? '';
    await page.goto(`/admin/products/${idA}`);
    await page.getByTestId('admin-merge-target').fill(idB || idA);
    await page.getByTestId('admin-merge-preview').click();
    await expect(page.getByTestId('admin-merge-preview-json')).toBeVisible({ timeout: 15000 });
  });
});
