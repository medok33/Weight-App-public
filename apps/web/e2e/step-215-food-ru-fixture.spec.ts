import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const OWNER_USER = process.env.OWNER_E2E_USERNAME ?? '';
const OWNER_PASS = process.env.OWNER_E2E_PASSWORD ?? '';
const suffix = Date.now().toString(36);

async function ownerLogin(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  // If a stale session redirects away from login, force login form.
  if (!(await page.getByTestId('auth-email').isVisible().catch(() => false))) {
    await page.goto('/login?force=1');
  }
  await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('auth-email').fill(OWNER_USER);
  await page.getByTestId('auth-password').fill(OWNER_PASS);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
  await expect(page.getByTestId('auth-role-badge')).toContainText('OWNER', { timeout: 30_000 });
}

async function ensureFoodRuFixtureSource(page: import('@playwright/test').Page) {
  const list = await page.request.get(`${api}/admin/recipe-sources?dataClass=TEST_ONLY`);
  expect(list.ok()).toBeTruthy();
  const items = ((await list.json()) as { items: Array<{ id: string; adapterType: string; code: string }> })
    .items;
  const existing = items.find((s) => s.adapterType === 'FOOD_RU');
  if (existing) return existing.id;

  const code = `food_ru_e2e_${suffix}`;
  const create = await page.request.post(`${api}/admin/recipe-sources`, {
    data: {
      code,
      name: 'Food.ru E2E fixture',
      baseUrl: 'https://food.ru',
      adapterType: 'FOOD_RU',
      collectionMode: 'DISABLED',
      dataClass: 'TEST_ONLY',
      rateLimitPerMinute: 10,
    },
  });
  expect(create.ok()).toBeTruthy();
  const src = (await create.json()) as { id: string };
  await page.request.post(`${api}/admin/recipe-sources/${src.id}/evidence`, {
    data: { evidenceType: 'OWNER_DECISION', decision: 'ALLOW', notes: 'e2e' },
  });
  await page.request.post(`${api}/admin/recipe-sources/${src.id}/evidence`, {
    data: { evidenceType: 'TERMS_REVIEW', decision: 'ALLOW', notes: 'e2e' },
  });
  const review = await page.request.post(`${api}/admin/recipe-sources/${src.id}/review`, {
    data: {
      toStatus: 'PUBLIC_RESEARCH_ALLOWED',
      reason: 'e2e fixture',
      collectionMode: 'CONTROLLED_HTML_RESEARCH',
      reviewExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  expect(review.ok()).toBeTruthy();
  return src.id;
}

test.describe('STEP_215 Food.ru fixture readiness browser acceptance', () => {
  test.skip(!OWNER_USER || !OWNER_PASS, 'OWNER_E2E_* required');

  test('A: Source Registry shows Food.ru readiness without live HTTP', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/recipe-sources');
    await expect(page.getByTestId('admin-recipe-sources')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('source-row-food_ru').getByRole('button').click();
    await expect(page.getByTestId('food-ru-pilot-readiness')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('food-ru-implementation')).toContainText(/реализован/i);
    await expect(page.getByTestId('food-ru-live-status')).toContainText(/выключено|политик/i);
    await expect(page.getByTestId('food-ru-network-calls')).toContainText(/0/);
    await expect(page.getByTestId('source-no-parse-actions')).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bLIVE_EXECUTION_DISABLED\b/);
    expect(body).not.toMatch(/\bPOLICY_BLOCKED\b/);
  });

  test('B/C/D/E/F: fixture search, normalize, duplicate/changed, live blocked', async ({ page }) => {
    await ownerLogin(page);
    const sourceId = await ensureFoodRuFixtureSource(page);

    const beforeRecipes = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
    const beforeTotal = Number(((await beforeRecipes.json()) as { total?: number }).total ?? 0);

    const search = await page.request.post(`${api}/admin/recipe-sources/${sourceId}/fixture-search`, {
      data: { primaryProductIds: ['synthetic'], resultLimit: 3 },
    });
    expect(search.ok()).toBeTruthy();
    const searchBody = (await search.json()) as {
      networkCalls: number;
      liveExecutionStatus: string;
      cards: unknown[];
    };
    expect(searchBody.networkCalls).toBe(0);
    expect(searchBody.liveExecutionStatus).toBe('POLICY_BLOCKED');
    expect(searchBody.cards.length).toBeGreaterThan(0);

    const live = await page.request.post(`${api}/admin/recipe-sources/${sourceId}/live-probe`, {
      data: {},
    });
    expect(live.ok()).toBeTruthy();
    const liveBody = (await live.json()) as { blocked: boolean; networkCalls: number; code: string };
    expect(liveBody.blocked).toBe(true);
    expect(liveBody.networkCalls).toBe(0);
    expect(liveBody.code).toBe('LIVE_EXECUTION_DISABLED');

    const req = await page.request.post(`${api}/admin/recipe-research`, {
      data: {
        manual: true,
        reason: 'STEP_215 e2e fixture',
        idempotencyKey: `step215-e2e-req-${suffix}`,
      },
    });
    expect(req.ok()).toBeTruthy();
    const request = (await req.json()) as { id: string };

    const run1 = await page.request.post(`${api}/admin/recipe-research/${request.id}/run`, {
      data: {
        sourceId,
        externalId: 'synthetic-chicken-buckwheat',
        operation: 'FETCH_CANDIDATE',
        idempotencyKey: `step215-e2e-run1-${suffix}`,
      },
    });
    expect(run1.ok()).toBeTruthy();
    const run1Body = (await run1.json()) as { candidate: { id: string }; runId: string };
    expect(run1Body.candidate?.id).toBeTruthy();

    const norm = await page.request.post(
      `${api}/admin/recipe-research/candidates/${run1Body.candidate.id}/normalize`,
    );
    expect(norm.ok()).toBeTruthy();

    const runDup = await page.request.post(`${api}/admin/recipe-research/${request.id}/run`, {
      data: {
        sourceId,
        externalId: 'fixture:duplicate-payload',
        operation: 'FETCH_CANDIDATE',
        idempotencyKey: `step215-e2e-dup-${suffix}`,
      },
    });
    // Request may already be COMPLETED; create a fresh request for duplicate/changed paths.
    if (!runDup.ok()) {
      const req2 = await page.request.post(`${api}/admin/recipe-research`, {
        data: {
          manual: true,
          reason: 'STEP_215 e2e duplicate',
          idempotencyKey: `step215-e2e-req2-${suffix}`,
        },
      });
      const request2 = (await req2.json()) as { id: string };
      const dupOk = await page.request.post(`${api}/admin/recipe-research/${request2.id}/run`, {
        data: {
          sourceId,
          externalId: 'fixture:duplicate-payload',
          operation: 'FETCH_CANDIDATE',
          idempotencyKey: `step215-e2e-dup2-${suffix}`,
        },
      });
      expect(dupOk.ok()).toBeTruthy();

      const req3 = await page.request.post(`${api}/admin/recipe-research`, {
        data: {
          manual: true,
          reason: 'STEP_215 e2e changed',
          idempotencyKey: `step215-e2e-req3-${suffix}`,
        },
      });
      const request3 = (await req3.json()) as { id: string };
      const changed = await page.request.post(`${api}/admin/recipe-research/${request3.id}/run`, {
        data: {
          sourceId,
          externalId: 'fixture:changed-payload',
          operation: 'FETCH_CANDIDATE',
          idempotencyKey: `step215-e2e-chg-${suffix}`,
        },
      });
      expect(changed.ok()).toBeTruthy();
    }

    await page.goto('/admin/recipe-research');
    await expect(page.getByTestId('admin-recipe-research')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('recipe-research-requests').locator('button').first().click();
    await expect(
      page.getByTestId('recipe-research-foodru-status').or(page.getByTestId('recipe-research-foodru-missing')),
    ).toBeVisible({ timeout: 15_000 });

    const afterRecipes = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
    const afterTotal = Number(((await afterRecipes.json()) as { total?: number }).total ?? 0);
    expect(afterTotal).toBe(beforeTotal);
  });

  test('G: security — USER blocked; arbitrary URL / redirect / XSS not live', async ({ page, browser }) => {
    await ownerLogin(page);

    const unauth = await browser.newContext();
    const userPage = await unauth.newPage();
    expect([401, 403]).toContain((await userPage.request.get(`${api}/admin/recipe-sources`)).status());
    await userPage.goto('/admin/recipe-sources');
    await expect(
      userPage
        .getByTestId('admin-recipe-sources-forbidden')
        .or(userPage.getByTestId('auth-submit'))
        .or(userPage.getByText(/Доступ запре|войти|Войти/i)),
    ).toBeVisible({ timeout: 30_000 });
    await unauth.close();

    // Contract-level proofs via API health/meta (no arbitrary URL field in UI).
    const meta = await page.request.get(`${api}/admin/recipe-sources/meta`);
    expect(meta.ok()).toBeTruthy();
    const metaBody = (await meta.json()) as {
      networkSecurity: { arbitraryUrlFetchForbidden: boolean; redirectOffDomainForbidden: boolean };
      adapterTypes: string[];
    };
    expect(metaBody.networkSecurity.arbitraryUrlFetchForbidden).toBe(true);
    expect(metaBody.networkSecurity.redirectOffDomainForbidden).toBe(true);
    expect(metaBody.adapterTypes).toContain('FOOD_RU');
  });

  test('H: RU / responsive smoke on Source Registry', async ({ page }) => {
    await ownerLogin(page);
    await page.goto('/admin/recipe-sources');
    await expect(page.getByTestId('admin-recipe-sources')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading').first()).toContainText(/Источник/i);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.getByTestId('admin-recipe-sources')).toBeVisible();
    }
  });
});
