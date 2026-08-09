import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const OWNER_USER = process.env.OWNER_E2E_USERNAME ?? '';
const OWNER_PASS = process.env.OWNER_E2E_PASSWORD ?? '';
const suffix = Date.now().toString(36);

async function ownerLogin(page: import('@playwright/test').Page) {
  // Establish session via API first so UI auth bootstrap cannot hang on a stale cookie race.
  const loginRes = await page.request.post(`${api}/auth/login`, {
    data: { identifier: OWNER_USER, password: OWNER_PASS },
  });
  expect(loginRes.ok()).toBeTruthy();
  await page.goto('/dashboard-today');
  await expect(page.getByTestId('auth-role-badge')).toContainText('OWNER', { timeout: 30_000 });
}

async function ensureFixtureSource(
  page: import('@playwright/test').Page,
  input: {
    adapterType: 'FOOD_RU' | 'IAMCOOK' | 'RUSSIANFOOD';
    codePrefix: string;
    name: string;
    baseUrl: string;
  },
) {
  const list = await page.request.get(`${api}/admin/recipe-sources?dataClass=TEST_ONLY`);
  expect(list.ok()).toBeTruthy();
  const items = ((await list.json()) as { items: Array<{ id: string; adapterType: string; code: string }> })
    .items;
  const existing = items.find((s) => s.adapterType === input.adapterType && s.code.includes('215c_e2e'));
  if (existing) return existing.id;

  const create = await page.request.post(`${api}/admin/recipe-sources`, {
    data: {
      code: `${input.codePrefix}_215c_e2e_${suffix}`,
      name: input.name,
      baseUrl: input.baseUrl,
      adapterType: input.adapterType,
      collectionMode: 'DISABLED',
      dataClass: 'TEST_ONLY',
      rateLimitPerMinute: 10,
    },
  });
  expect(create.ok()).toBeTruthy();
  const src = (await create.json()) as { id: string };
  await page.request.post(`${api}/admin/recipe-sources/${src.id}/evidence`, {
    data: { evidenceType: 'OWNER_DECISION', decision: 'ALLOW', notes: 'e2e 215c' },
  });
  await page.request.post(`${api}/admin/recipe-sources/${src.id}/evidence`, {
    data: { evidenceType: 'TERMS_REVIEW', decision: 'ALLOW', notes: 'e2e 215c' },
  });
  const review = await page.request.post(`${api}/admin/recipe-sources/${src.id}/review`, {
    data: {
      toStatus: 'PUBLIC_RESEARCH_ALLOWED',
      reason: 'e2e multi-source fixture',
      collectionMode: 'CONTROLLED_HTML_RESEARCH',
      reviewExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  expect(review.ok()).toBeTruthy();
  return src.id;
}

test.describe('STEP_215C multi-source fixture parity', () => {
  test.skip(!OWNER_USER || !OWNER_PASS, 'OWNER_E2E credentials required');

  test('A–G: three fixture runs, independent candidates, comparison UI, live blocked, RU', async ({
    page,
  }) => {
    await ownerLogin(page);

    const meta = await page.request.get(`${api}/admin/recipe-sources/meta`);
    expect(meta.ok()).toBeTruthy();
    const metaBody = await meta.json();
    expect(metaBody.adapterTypes).toEqual(
      expect.arrayContaining(['FOOD_RU', 'IAMCOOK', 'RUSSIANFOOD']),
    );
    expect(metaBody.networkSecurity.arbitraryUrlFetchForbidden).toBe(true);

    const seeds = await page.request.get(`${api}/admin/recipe-sources`);
    const seedItems = ((await seeds.json()) as {
      items: Array<{ code: string; adapterType: string; enabled: boolean }>;
    }).items;
    for (const code of ['food_ru', 'iamcook', 'russianfood']) {
      const row = seedItems.find((i) => i.code === code);
      expect(row?.enabled).toBe(false);
      expect(row?.adapterType).toBe('NOT_CONFIGURED');
    }

    await page.goto('/admin/recipe-sources');
    await expect(page.getByTestId('admin-recipe-sources')).toBeVisible({ timeout: 30_000 });
    const sourcesText = await page.locator('body').innerText();
    expect(sourcesText).toMatch(/Food\.ru/);
    expect(sourcesText).toMatch(/Аймкук|iamcook/i);
    expect(sourcesText).toMatch(/RussianFood/i);
    expect(sourcesText).not.toMatch(/\bLIVE_EXECUTION_DISABLED\b/);
    expect(sourcesText).not.toMatch(/\bwinner\b/i);

    const foodRuId = await ensureFixtureSource(page, {
      adapterType: 'FOOD_RU',
      codePrefix: 'food_ru',
      name: 'Food.ru 215C E2E',
      baseUrl: 'https://food.ru',
    });
    const iamcookId = await ensureFixtureSource(page, {
      adapterType: 'IAMCOOK',
      codePrefix: 'iamcook',
      name: 'IamCook 215C E2E',
      baseUrl: 'https://www.iamcook.ru',
    });
    const russianfoodId = await ensureFixtureSource(page, {
      adapterType: 'RUSSIANFOOD',
      codePrefix: 'russianfood',
      name: 'RussianFood 215C E2E',
      baseUrl: 'https://www.russianfood.com',
    });

    for (const sourceId of [foodRuId, iamcookId, russianfoodId]) {
      const search = await page.request.post(`${api}/admin/recipe-sources/${sourceId}/fixture-search`, {
        data: { primaryProductIds: ['synthetic'], resultLimit: 2 },
      });
      expect(search.ok()).toBeTruthy();
      const searchBody = (await search.json()) as {
        networkCalls: number;
        liveExecutionStatus: string;
      };
      expect(searchBody.networkCalls).toBe(0);
      expect(searchBody.liveExecutionStatus).toBe('POLICY_BLOCKED');

      const live = await page.request.post(`${api}/admin/recipe-sources/${sourceId}/live-probe`, {
        data: {},
      });
      expect(live.ok()).toBeTruthy();
      const liveBody = (await live.json()) as {
        blocked: boolean;
        networkCalls: number;
        code: string;
      };
      expect(liveBody.blocked).toBe(true);
      expect(liveBody.networkCalls).toBe(0);
      expect(liveBody.code).toBe('LIVE_EXECUTION_DISABLED');
    }

    const req = await page.request.post(`${api}/admin/recipe-research`, {
      data: {
        manual: true,
        reason: 'STEP_215C multi-source e2e',
        idempotencyKey: `step215c-e2e-req-${suffix}`,
      },
    });
    expect(req.ok()).toBeTruthy();
    const request = (await req.json()) as { id: string };

    await page.goto('/admin/recipe-research');
    await expect(page.getByTestId('admin-recipe-research')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: request.id.slice(0, 8) }).click();
    await expect(page.getByTestId('recipe-research-foodru-status')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('recipe-research-iamcook-status')).toBeVisible();
    await expect(page.getByTestId('recipe-research-russianfood-status')).toBeVisible();
    await expect(page.getByTestId('recipe-research-parity-dish')).toBeEnabled();

    // Browser flow: Food.ru + IamCook + RussianFood fixture runs via Admin UI.
    await page.getByTestId('recipe-research-parity-dish').click();
    await expect(page.getByTestId('multi-source-compare-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('recipe-research-candidates').locator('li')).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('multi-source-no-winner')).toContainText(/не выбирается|сопоставление/i);

    const listed = await page.request.get(`${api}/admin/recipe-research/${request.id}/candidates`);
    expect(listed.ok()).toBeTruthy();
    const listedBody = (await listed.json()) as { items: Array<{ id: string; parserVersion: string }> };
    expect(listedBody.items).toHaveLength(3);
    expect(new Set(listedBody.items.map((c) => c.id)).size).toBe(3);
    expect(listedBody.items.map((c) => c.parserVersion).sort()).toEqual([
      'food-ru/v1',
      'iamcook/v1',
      'russianfood/v1',
    ]);

    const researchText = await page.locator('body').innerText();
    expect(researchText).toMatch(/Исследован|кандидат|Источник/i);
    expect(researchText).toMatch(/Food\.ru/);
    expect(researchText).toMatch(/Аймкук/);
    expect(researchText).toMatch(/RussianFood/);
    expect(researchText).toMatch(/networkCalls=0/);
    // Allow the explicit "Победитель не выбирается" disclaimer; reject ranking/winner selection copy.
    expect(researchText).not.toMatch(/лучший источник|DeepSeek|winner ranking/i);
    expect(researchText).not.toMatch(/выбирается победитель|ранжирование победител/i);
  });

  test('H: unauthenticated USER denied source registry', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const unauth = await anon.get(`${api}/admin/recipe-sources`);
    expect([401, 403]).toContain(unauth.status());
    await anon.dispose();
  });
});
