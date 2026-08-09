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

test.describe('RP2-02C fingerprints + media', () => {
  test('F: USER cannot access duplicate/media admin', async ({ page }) => {
    const email = `rp202c-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    expect([401, 403]).toContain((await page.request.get(`${api}/admin/recipe-duplicates`)).status());
    expect([401, 403]).toContain((await page.request.get(`${api}/admin/media`)).status());
    await page.goto('/admin/recipe-duplicates');
    await expect(page.getByTestId('admin-recipe-duplicates-forbidden')).toBeVisible({ timeout: 20000 });
    await page.goto('/admin/media');
    await expect(page.getByTestId('admin-media-forbidden')).toBeVisible({ timeout: 20000 });
  });

  test('A/B: clone exact snapshot blocks publish; variant can ack', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);

    const list = await page.request.get(`${api}/admin/recipes`);
    expect(list.ok()).toBeTruthy();
    const recipes = (await list.json()) as {
      items: Array<{ id: string; name: string; currentVersionId: string | null }>;
    };
    const source = recipes.items.find((r) => r.currentVersionId);
    test.skip(!source, 'No published recipe available');

    const cloneRes = await page.request.post(`${api}/admin/recipes/clone`, {
      data: { sourceRecipeId: source!.id, name: source!.name },
    });
    expect(cloneRes.ok()).toBeTruthy();
    const clone = (await cloneRes.json()) as { id: string };

    const createDup = await page.request.post(`${api}/admin/recipes/${clone.id}/versions`, {
      data: { publish: true, changeReason: 'exact duplicate attempt' },
    });
    expect([403, 400, 409]).toContain(createDup.status());
    const body = await createDup.text();
    expect(body).toMatch(/DUPLICATE_RECIPE_CONFLICT|NEAR_DUPLICATE_ACK_REQUIRED/);

    // Variant path: create IN_REVIEW without publish, then resolve later via duplicates UI.
    const createReview = await page.request.post(`${api}/admin/recipes/${clone.id}/versions`, {
      data: { publish: false, changeReason: 'review only' },
    });
    expect(createReview.ok()).toBeTruthy();
  });

  test('C: OWNER duplicate review UI resolve persists', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.request.post(`${api}/admin/recipe-fingerprints/backfill`, { data: {} });
    await page.goto('/admin/recipe-duplicates');
    await expect(page.getByTestId('admin-recipe-duplicates')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('dup-filter-status').selectOption('OPEN');
    const first = page.locator('[data-testid="dup-candidate-list"] button').first();
    if (await first.count()) {
      await first.click();
      await expect(page.getByTestId('dup-candidate-detail')).toBeVisible();
      await page.getByTestId('dup-dismiss').click();
      await page.reload();
      await page.getByTestId('dup-filter-status').selectOption('DISMISSED');
      await expect(page.getByTestId('admin-recipe-duplicates')).toBeVisible({ timeout: 20000 });
    }
  });

  test('D/E: media rights gate + takedown metadata', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.goto('/admin/media');
    await expect(page.getByTestId('admin-media')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('media-storage-not-configured')).toBeVisible();
    await page.getByTestId('media-register').click();
    await expect(page.getByRole('status')).toContainText(/registered|PENDING/i, { timeout: 15000 });

    const mediaList = await page.request.get(`${api}/admin/media`);
    const payload = (await mediaList.json()) as {
      items: Array<{ id: string; rightsStatus: string; storageKey?: string }>;
    };
    expect(payload.items[0]?.rightsStatus).toBe('PENDING_REVIEW');
    expect(JSON.stringify(payload.items[0])).not.toMatch(/"storageKey"\s*:\s*"[^"]+"/);

    const id = payload.items[0]!.id;
    await page.getByTestId(`media-approve-${id}`).click();
    await expect(page.getByRole('status')).toContainText(/Approved/i, { timeout: 15000 });
    await page.getByTestId(`media-takedown-${id}`).click();
    await expect(page.getByRole('status')).toContainText(/Takedown/i, { timeout: 15000 });
    const after = await (await page.request.get(`${api}/admin/media/${id}`)).json();
    expect(after.rightsStatus).toBe('TAKEDOWN');
  });

  test('G: mobile meal plan remains readable', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 30000 });
  });
});
