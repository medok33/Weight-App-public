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

test.describe('RP2-03A coverage matrix foundation', () => {
  test('D: USER cannot access coverage admin', async ({ page }) => {
    const email = `rp203a-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });
    expect([401, 403]).toContain((await page.request.get(`${api}/admin/recipe-coverage/slots`)).status());
    await page.goto('/admin/recipe-coverage/slots');
    await expect(page.getByTestId('admin-recipe-coverage-forbidden')).toBeVisible({ timeout: 20000 });
  });

  test('A/B: OWNER matrix filters, detail, seed snapshot', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.request.post(`${api}/admin/recipe-coverage/matrix/seed`, { data: {} });
    await page.goto('/admin/recipe-coverage/slots');
    await expect(page.getByTestId('admin-recipe-coverage')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('coverage-matrix-version')).toContainText('coverage-core-v1');
    await page.getByTestId('coverage-filter-meal').selectOption('lunch');
    await page.getByTestId('coverage-filter-priority').selectOption('CRITICAL');
    await expect(page.getByTestId('coverage-slot-list')).toBeVisible({ timeout: 15000 });
    const first = page.locator('[data-testid="coverage-slot-list"] button').first();
    if (await first.count()) {
      await first.click();
      await expect(page.getByTestId('coverage-slot-detail')).toBeVisible();
      await expect(page.getByTestId('coverage-slot-rationale')).not.toBeEmpty();
    }
    await page.reload();
    await expect(page.getByTestId('admin-recipe-coverage')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('coverage-matrix-version')).toContainText('coverage-core-v1');
  });

  test('C: create slot rejects duplicate key and publishedRecipeCount mass-assignment', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    const forbiddenCount = await page.request.post(`${api}/admin/recipe-coverage/slots`, {
      data: {
        name: 'Hack count',
        mealType: 'lunch',
        dishType: 'MAIN',
        dietaryProfile: 'GENERAL',
        equipmentProfile: 'BASIC_STOVE',
        priority: 'LOW',
        desiredRecipeCount: 1,
        provenance: 'E2E',
        rationale: 'mass assignment probe',
        publishedRecipeCount: 99,
      },
    });
    expect([403, 400]).toContain(forbiddenCount.status());

    const created = await page.request.post(`${api}/admin/recipe-coverage/slots`, {
      data: {
        name: `E2E Slot ${Date.now()}`,
        mealType: 'snack',
        dishType: 'SNACK',
        cookingMethod: 'RAW',
        calorieMin: 50,
        calorieMax: 200,
        dietaryProfile: 'GENERAL',
        equipmentProfile: 'NO_SPECIAL_EQUIPMENT',
        priority: 'LOW',
        desiredRecipeCount: 1,
        provenance: 'E2E',
        rationale: 'controlled e2e slot',
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    const createdId = String(body.id);
    try {
      const dup = await page.request.post(`${api}/admin/recipe-coverage/slots`, {
        data: {
          name: 'Dup key',
          mealType: 'snack',
          dishType: 'SNACK',
          cookingMethod: 'RAW',
          calorieMin: 50,
          calorieMax: 200,
          dietaryProfile: 'GENERAL',
          equipmentProfile: 'NO_SPECIAL_EQUIPMENT',
          priority: 'LOW',
          desiredRecipeCount: 1,
          provenance: 'E2E',
          rationale: 'duplicate probe',
        },
      });
      expect([403, 400]).toContain(dup.status());
      expect(body.publishedRecipeCount).toBe(0);
    } finally {
      const cleanup = await page.request.delete(`${api}/admin/recipe-coverage/slots/${createdId}`, {
        data: { reason: 'e2e cleanup keep coverage-core-v1 at 60' },
      });
      expect(cleanup.ok()).toBeTruthy();
    }
  });
});
