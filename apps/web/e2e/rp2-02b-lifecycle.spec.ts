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

test.describe('RP2-02B lifecycle + revalidation', () => {
  test('G: USER cannot access lifecycle/revalidation admin', async ({ page }) => {
    const email = `rp202b-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    const forbiddenLife = await page.request.get(`${api}/admin/recipe-revalidation`);
    expect([401, 403]).toContain(forbiddenLife.status());
    await page.goto('/admin/recipe-revalidation');
    await expect(page.getByTestId('admin-recipe-revalidation-forbidden')).toBeVisible({
      timeout: 20000,
    });
  });

  test('A: OWNER lifecycle IN_REVIEW → approve → publish', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);

    const list = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=20`);
    expect(list.ok()).toBeTruthy();
    const recipes = (await list.json()) as {
      items: Array<{ id: string; currentVersionId: string | null }>;
    };
    const source = recipes.items.find((r) => r.currentVersionId);
    test.skip(!source, 'No production recipe with current version');

    const create = await page.request.post(`${api}/admin/recipes/${source!.id}/versions`, {
      data: { publish: false, changeReason: 'RP2-02B regression IN_REVIEW' },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()) as { id: string; versionNumber?: number };

    await page.goto(`/admin/recipes/${source!.id}`);
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Lifecycle' }).click();
    await page.getByRole('button', { name: `v${created.versionNumber}`, exact: true }).click();
    await expect(page.getByTestId(`version-lifecycle-${created.versionNumber}`)).toContainText('На проверке', {
      timeout: 15000,
    });
    await expect(page.getByTestId('lifecycle-approve')).toBeVisible();

    await page.getByTestId('lifecycle-approve').click();
    await expect(page.getByTestId(`version-lifecycle-${created.versionNumber}`)).toContainText('Одобрена', {
      timeout: 15000,
    });
    const published = await page.request.post(
      `${api}/admin/recipes/${source!.id}/versions/${created.id}/publish`,
      {
        data: {
          acknowledgeNearDuplicate: true,
          overrideExactDuplicate: true,
          overrideReason: 'RP2-02B lifecycle regression publish',
        },
      },
    );
    expect(published.ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: 'Lifecycle' }).click();
    await expect(page.getByTestId(`version-lifecycle-${created.versionNumber}`)).toContainText('Опубликована', {
      timeout: 15000,
    });
  });

  test('B/C/H: historical meal plan + mobile smoke after lifecycle', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('meal-day-tab-0').click();
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 20000 });
    const firstDish = page.locator('[data-testid^="meal-dish-card-"]').first();
    if (await firstDish.count()) {
      await firstDish.click();
      await expect(page.getByTestId('meal-dish-detail')).toBeVisible({ timeout: 15000 });
    }
    await page.goto('/shopping-list');
    await expect(page.getByTestId('shopping-heading')).toBeVisible({ timeout: 20000 });
  });

  test('F: OWNER opens revalidation queue', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/recipe-revalidation');
    await expect(page.getByTestId('admin-recipe-revalidation')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('reval-filter-status')).toBeVisible();
  });
});
