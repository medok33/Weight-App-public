import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const OWNER_USER = process.env.OWNER_E2E_USERNAME ?? '';
const OWNER_PASS = process.env.OWNER_E2E_PASSWORD ?? '';
const suffix = Date.now().toString(36);

async function ownerLogin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(OWNER_USER);
  await page.getByTestId('auth-password').fill(OWNER_PASS);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
  await expect(page.getByTestId('auth-role-badge')).toContainText('OWNER', { timeout: 30_000 });
}

test.describe('RP2-04A STEP_213/214 external source registry', () => {
  test.skip(!OWNER_USER || !OWNER_PASS, 'OWNER_E2E_* required');

  test('A: SOURCE REGISTRY — pending list, create, evidence, reload', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/recipe-sources');
    await expect(page.getByTestId('admin-recipe-sources')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('source-row-food_ru')).toBeVisible();
    await expect(page.getByTestId('source-row-iamcook')).toBeVisible();
    await expect(page.getByTestId('source-row-russianfood')).toBeVisible();

    const code = `manual_e2e_${suffix}`;
    await page.getByTestId('source-create-code').fill(code);
    await page.getByTestId('source-create-name').fill('Manual E2E source');
    await page.getByTestId('source-create-url').fill('https://example.com/e2e');
    await page.getByTestId('source-create-submit').click();
    await expect(page.getByTestId('recipe-sources-message')).toContainText(/создан|Источник/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId(`source-row-${code}`)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`source-row-${code}`).getByRole('button').click();
    await expect(page.getByTestId('recipe-source-detail')).toBeVisible();
    await page.getByTestId('source-evidence-notes').fill('E2E OWNER decision evidence');
    await page.getByTestId('source-evidence-add').click();
    await expect(page.getByTestId('source-evidence-list')).toContainText(/OWNER_DECISION|Решение владельца/i, {
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByTestId(`source-row-${code}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`source-row-${code}`).getByRole('button').click();
    await expect(page.getByTestId('source-evidence-list')).toContainText(/OWNER_DECISION|Решение владельца/i);
    await expect(page.getByTestId('source-no-parse-actions')).toBeVisible();
  });

  test('B: RIGHTS GATE — pending block, review, enable, suspend', async ({ page }) => {
    await ownerLogin(page);
    const code = `rights_e2e_${suffix}`;
    const create = await page.request.post(`${api}/admin/recipe-sources`, {
      data: {
        code,
        name: 'Rights gate E2E',
        baseUrl: 'https://example.com/rights',
        adapterType: 'NOT_CONFIGURED',
        collectionMode: 'DISABLED',
      },
    });
    expect(create.ok()).toBeTruthy();
    const src = (await create.json()) as { id: string };

    const blocked = await page.request.post(`${api}/admin/recipe-sources/${src.id}/enable`, {
      data: { reason: 'should fail' },
    });
    expect(blocked.status()).toBeGreaterThanOrEqual(400);

    await page.request.post(`${api}/admin/recipe-sources/${src.id}/evidence`, {
      data: { evidenceType: 'OWNER_DECISION', decision: 'ALLOW', notes: 'allow' },
    });
    await page.request.post(`${api}/admin/recipe-sources/${src.id}/evidence`, {
      data: { evidenceType: 'TERMS_REVIEW', decision: 'ALLOW', notes: 'terms' },
    });
    const review = await page.request.post(`${api}/admin/recipe-sources/${src.id}/review`, {
      data: {
        toStatus: 'PUBLIC_RESEARCH_ALLOWED',
        reason: 'OWNER approved limited research',
        collectionMode: 'PUBLIC_FEED',
        reviewExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    });
    expect(review.ok()).toBeTruthy();

    const enabled = await page.request.post(`${api}/admin/recipe-sources/${src.id}/enable`, {
      data: { reason: 'enable after review' },
    });
    expect(enabled.ok()).toBeTruthy();
    const enabledBody = (await enabled.json()) as {
      enabled: boolean;
      blockingReason: string | null;
      execution: { automatedAllowed: boolean };
    };
    expect(enabledBody.enabled).toBe(true);
    expect(enabledBody.execution.automatedAllowed).toBe(false);

    await page.goto('/admin/recipe-sources');
    await page.getByTestId(`source-row-${code}`).getByRole('button').click();
    await expect(page.getByTestId('source-blocking-reason')).toBeVisible();

    const suspend = await page.request.post(`${api}/admin/recipe-sources/${src.id}/review`, {
      data: {
        toStatus: 'SUSPENDED',
        reason: 'temp suspend',
        collectionMode: 'DISABLED',
      },
    });
    expect(suspend.ok()).toBeTruthy();
    const suspended = (await suspend.json()) as {
      enabled: boolean;
      execution: { eligibility: string };
    };
    expect(suspended.enabled).toBe(false);
    expect(suspended.execution.eligibility).toBe('TEMPORARILY_SUSPENDED');
  });

  test('C: CONTRACT TEST ADAPTER — health-check, isolation, no network', async ({ page }) => {
    await ownerLogin(page);
    const code = `test_e2e_${suffix}`;
    const create = await page.request.post(`${api}/admin/recipe-sources`, {
      data: {
        code,
        name: 'Test only source',
        baseUrl: 'https://example.com/test-adapter',
        adapterType: 'TEST_DETERMINISTIC',
        collectionMode: 'DISABLED',
        dataClass: 'TEST_ONLY',
        rateLimitPerMinute: 20,
      },
    });
    expect(create.ok()).toBeTruthy();
    const src = (await create.json()) as { id: string };

    const health = await page.request.post(`${api}/admin/recipe-sources/${src.id}/health-check`);
    expect(health.ok()).toBeTruthy();
    const healthBody = (await health.json()) as { ok: boolean; networkCalls: number };
    expect(healthBody.ok).toBe(true);
    expect(healthBody.networkCalls).toBe(0);

    const prodBind = await page.request.post(`${api}/admin/recipe-sources`, {
      data: {
        code: `prod_test_${suffix}`,
        name: 'Should fail',
        baseUrl: 'https://example.com/x',
        adapterType: 'TEST_DETERMINISTIC',
        dataClass: 'PRODUCTION',
      },
    });
    expect(prodBind.status()).toBeGreaterThanOrEqual(400);

    const foodRu = await page.request.get(`${api}/admin/recipe-sources?rightsStatus=PENDING_REVIEW`);
    const list = (await foodRu.json()) as { items: Array<{ code: string; adapterType: string }> };
    const food = list.items.find((i) => i.code === 'food_ru');
    expect(food?.adapterType).toBe('NOT_CONFIGURED');
  });

  test('D: PERMISSIONS — USER blocked, mass-assignment / arbitrary module rejected', async ({
    page,
    browser,
  }) => {
    await ownerLogin(page);

    const mass = await page.request.post(`${api}/admin/recipe-sources`, {
      data: {
        code: `mass_${suffix}`,
        name: 'Mass',
        baseUrl: 'https://example.com/mass',
        rightsStatus: 'ACTIVE_LICENSED',
        enabled: true,
        reviewedBy: '00000000-0000-0000-0000-000000000001',
        adapterModule: './evil.js',
      },
    });
    expect(mass.status()).toBeGreaterThanOrEqual(400);

    const userCtx = await browser.newContext();
    const userPage = await userCtx.newPage();
    const unauth = await userPage.request.get(`${api}/admin/recipe-sources`);
    expect([401, 403]).toContain(unauth.status());
    await userPage.goto('/admin/recipe-sources');
    await expect(
      userPage.getByTestId('admin-recipe-sources-forbidden').or(userPage.getByTestId('auth-submit')),
    ).toBeVisible({ timeout: 30_000 });
    await userCtx.close();
  });

  test('E: RESPONSIVE smoke', async ({ page }) => {
    await ownerLogin(page);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/admin/recipe-sources');
      await expect(page.getByTestId('admin-recipe-sources')).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="admin-recipe-sources"]');
        if (!el) return true;
        return el.scrollWidth > el.clientWidth + 24;
      });
      expect(overflow).toBeFalsy();
    }
  });
});
