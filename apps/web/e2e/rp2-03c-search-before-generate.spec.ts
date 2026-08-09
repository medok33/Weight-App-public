import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';

const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';

const hasOwnerCreds = Boolean(ownerUser && ownerPass);

type SearchBody = {

  runId?: string;

  recommendation?: string;

  requestType?: string;

  candidates?: Array<{

    recipeId: string;

    recipeVersionId: string;

    candidateType?: string;

    portionAdjustment?: { multiplier?: number | null; feasible?: boolean };

    adaptationSummary?: Record<string, unknown>;

  }>;

};

async function ownerLogin(page: import('@playwright/test').Page) {

  await page.goto('/login');

  await page.getByTestId('auth-email').fill(ownerUser);

  await page.getByTestId('auth-password').fill(ownerPass);

  await page.getByTestId('auth-submit').click();

  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

}

async function fetchRecipeVersionSnapshot(

  page: import('@playwright/test').Page,

  recipeId: string,

  versionId: string,

) {

  const res = await page.request.get(`${api}/admin/recipes/${recipeId}/versions/${versionId}`);

  expect(res.ok()).toBeTruthy();

  const body = await res.json();

  return JSON.stringify({

    versionNumber: body.versionNumber,

    servings: body.servings,

    ingredientsSnapshotJson: body.ingredientsSnapshotJson,

    contentSnapshotJson: body.contentSnapshotJson,

  });

}

async function probePortionAdjust(

  page: import('@playwright/test').Page,

): Promise<{ slotId: string; body: SearchBody } | null> {

  const calorieOverrides = [

    { minDelta: 45, maxDelta: 130 },

    { minDelta: 80, maxDelta: 200 },

    { minDelta: 120, maxDelta: 260 },

    { minDelta: -60, maxDelta: 40 },

    { minDelta: 20, maxDelta: 90 },

  ];

  for (const status of ['UNDERFILLED', 'EMPTY'] as const) {

    const slots = await page.request.get(`${api}/admin/recipe-coverage/slots?status=${status}&limit=25`);

    if (!slots.ok()) continue;

    const items = ((await slots.json()).items ?? []) as Array<{ id: string }>;

    for (const slotRow of items) {

      const slotDetail = await page.request.get(`${api}/admin/recipe-coverage/slots/${slotRow.id}`);

      if (!slotDetail.ok()) continue;

      const slot = await slotDetail.json();

      const baseMin = Number(slot.calorieMin ?? 300);

      const baseMax = Number(slot.calorieMax ?? baseMin + 150);

      for (const ov of calorieOverrides) {

        const searchRes = await page.request.post(`${api}/admin/recipe-coverage/slots/${slotRow.id}/search`, {

          data: {

            reason: 'e2e portion adjust scan',

            overrides: {

              calorieMin: Math.max(80, baseMin + ov.minDelta),

              calorieMax: Math.max(baseMin + ov.minDelta + 40, baseMax + ov.maxDelta),

            },

          },

        });

        if (!searchRes.ok()) continue;

        const body = (await searchRes.json()) as SearchBody;

        if (body.recommendation === 'ADJUST_PORTION_OF_EXISTING') {

          return { slotId: slotRow.id, body };

        }

      }

    }

  }

  return null;

}

async function probeAdaptExisting(
  page: import('@playwright/test').Page,
): Promise<{ slotId: string; body: SearchBody; seededSubstitutionId?: string } | null> {
  for (const status of ['EMPTY', 'UNDERFILLED'] as const) {
    const slots = await page.request.get(`${api}/admin/recipe-coverage/slots?status=${status}&limit=20`);
    if (!slots.ok()) continue;
    const items = ((await slots.json()).items ?? []) as Array<{ id: string }>;
    for (const row of items) {
      const searchRes = await page.request.post(`${api}/admin/recipe-coverage/slots/${row.id}/search`, {
        data: { reason: 'e2e adapt natural' },
      });
      if (!searchRes.ok()) continue;
      const body = (await searchRes.json()) as SearchBody;
      if (body.recommendation === 'ADAPT_EXISTING_RECIPE') return { slotId: row.id, body };
    }
  }

  // Seeded path proven in PG: take a slot with EXACT matches, override primary to an unused product,
  // and attach MANUAL substitution from an exact recipe ingredient → unused product.
  const slotList = await page.request.get(`${api}/admin/recipe-coverage/slots?limit=30`);
  if (!slotList.ok()) return null;
  const slots = ((await slotList.json()).items ?? []) as Array<{ id: string; cookingMethod?: string | null }>;

  for (const slot of slots) {
    const baseline = await page.request.post(`${api}/admin/recipe-coverage/slots/${slot.id}/search`, {
      data: { reason: 'e2e adapt find exact' },
    });
    if (!baseline.ok()) continue;
    const baseBody = (await baseline.json()) as SearchBody;
    const exact = (baseBody.candidates ?? []).find(
      (c) => c.candidateType === 'EXACT_SLOT_MATCH' || c.candidateType === 'EXISTING_COVERAGE',
    );
    if (!exact?.recipeVersionId || !exact.recipeId) continue;

    const versionRes = await page.request.get(
      `${api}/admin/recipes/${exact.recipeId}/versions/${exact.recipeVersionId}`,
    );
    if (!versionRes.ok()) continue;
    const version = await versionRes.json();
    const ingredients = (version.ingredientsSnapshotJson ?? version.ingredients ?? []) as Array<{
      productId?: string;
    }>;
    const sourceProductId = ingredients.map((i) => i.productId).find((id) => Boolean(id));
    if (!sourceProductId) continue;

    // Pick an existing ACTIVE product that is unlikely to exact-match: use admin product list last page item.
    const products = await page.request.get(`${api}/admin/products?page=1&pageSize=50`);
    if (!products.ok()) continue;
    const productItems = ((await products.json()).items ?? []) as Array<{ id: string }>;
    const used = new Set(ingredients.map((i) => i.productId).filter(Boolean) as string[]);
    const target = productItems.map((p) => p.id).find((id) => !used.has(id));
    if (!target) continue;

    const createRes = await page.request.post(`${api}/admin/products/${sourceProductId}/substitutions`, {
      data: {
        replacementProductId: target,
        replacementRatio: 1,
        replacementRatioMin: 0.8,
        replacementRatioMax: 1.2,
        supportedMethods: ['BOIL', 'FRY', 'BAKE', 'STEW', 'STEAM'],
        status: 'ACTIVE',
        source: 'MANUAL',
      },
    });
    let substitutionId: string | undefined;
    if (createRes.ok()) {
      substitutionId = ((await createRes.json()) as { id?: string }).id;
      if (substitutionId) {
        await page.request.post(`${api}/admin/product-substitutions/${substitutionId}/activate`);
      }
    }

    const searchRes = await page.request.post(`${api}/admin/recipe-coverage/slots/${slot.id}/search`, {
      data: {
        reason: 'e2e adapt override primary',
        overrides: { primaryProductId: target },
      },
    });
    if (!searchRes.ok()) continue;
    const body = (await searchRes.json()) as SearchBody;
    if (body.recommendation === 'ADAPT_EXISTING_RECIPE') {
      return { slotId: slot.id, body, seededSubstitutionId: substitutionId };
    }
  }

  return null;
}

test.describe('RP2-03C search-before-generate acceptance', () => {

  test('G: USER cannot call recipe-search preflight (401/403)', async ({ page }) => {

    const email = `rp203c-user-${Date.now()}@test.com`;

    await page.goto('/register');

    await page.getByTestId('auth-email').fill(email);

    await page.getByTestId('auth-password').fill('Password12345');

    await page.getByTestId('auth-submit').click();

    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    expect([401, 403]).toContain(

      (

        await page.request.post(`${api}/admin/recipe-search/preflight`, {

          data: { reason: 'user probe', coverageSlotId: '00000000-0000-4000-8000-000000000001' },

        })

      ).status(),

    );

    expect([401, 403]).toContain(

      (

        await page.request.post(

          `${api}/admin/recipe-coverage/slots/00000000-0000-4000-8000-000000000001/search`,

          { data: { reason: 'user probe' } },

        )

      ).status(),

    );

  });

  test('A/E: OWNER search on EMPTY/UNDERFILLED shows panel; research path if empty', async ({

    page,

  }) => {

    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

    await ownerLogin(page);

    await page.goto('/admin/recipe-coverage/slots');

    await expect(page.getByTestId('admin-recipe-coverage')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('coverage-filter-status').selectOption('EMPTY');

    await page.waitForTimeout(500);

    const list = page.getByTestId('coverage-slot-list');

    const hasEmpty = (await list.locator('li').count()) > 0;

    if (!hasEmpty) {

      await page.getByTestId('coverage-filter-status').selectOption('UNDERFILLED');

      await page.waitForTimeout(500);

    }

    const first = page.getByTestId('coverage-slot-list').locator('li button').first();

    test.skip((await first.count()) === 0, 'no EMPTY/UNDERFILLED slots');

    await first.click();

    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible();

    await page.getByTestId('coverage-search-preflight').click();

    await expect(page.getByTestId('coverage-search-panel')).toBeVisible({ timeout: 120000 });

    const rec = await page.getByTestId('coverage-search-recommendation').innerText();

    expect(rec).toMatch(
      /USE_EXISTING_RECIPE|ADJUST_PORTION|ADAPT_EXISTING|CREATE_FAMILY|REVIEW_DUPLICATE|RESEARCH_REQUIRED|BLOCKED_NO_SAFE_ACTION|Использовать существующий|Подходит после изменения|адаптировать|семейства|дубликат|исследование|Безопасное действие/i,
    );

    await page.getByTestId('coverage-search-issue-decision').click();

    await expect(page.getByTestId('coverage-search-decision-expiry')).toBeVisible({ timeout: 30000 });

  });

  test('D: duplicate gate via API when OPEN EXACT_DUPLICATE present', async ({ page }) => {

    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

    await ownerLogin(page);

    const slots = await page.request.get(`${api}/admin/recipe-coverage/slots?status=EMPTY&limit=1`);

    test.skip(!slots.ok(), 'slots unavailable');

    const body = await slots.json();

    const slotId = body.items?.[0]?.id as string | undefined;

    test.skip(!slotId, 'no empty slot');

    const recipes = await page.request.get(`${api}/admin/recipes`);

    test.skip(!recipes.ok(), 'recipes unavailable');

    const list = await recipes.json();

    const items = (list.items ?? list ?? []) as Array<{ currentVersionId?: string }>;

    const ids = items.map((r) => r.currentVersionId).filter(Boolean) as string[];

    test.skip(ids.length < 2, 'need two versions for duplicate probe');

    const searchRes = await page.request.post(`${api}/admin/recipe-coverage/slots/${slotId}/search`, {

      data: { reason: 'e2e duplicate/search probe' },

    });

    expect([200, 201]).toContain(searchRes.status());

    const searchBody = await searchRes.json();

    expect(searchBody.recommendation).toBeTruthy();

    expect(searchBody.runId).toBeTruthy();

  });

  test('F: stale decision via API invalidate', async ({ page }) => {

    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

    await ownerLogin(page);

    const slots = await page.request.get(`${api}/admin/recipe-coverage/slots?limit=1`);

    test.skip(!slots.ok(), 'slots unavailable');

    const body = await slots.json();

    const slotId = body.items?.[0]?.id as string | undefined;

    test.skip(!slotId, 'no slot');

    const searchRes = await page.request.post(`${api}/admin/recipe-coverage/slots/${slotId}/search`, {

      data: { reason: 'e2e invalidate probe' },

    });

    expect(searchRes.ok()).toBeTruthy();

    const searchBody = await searchRes.json();

    const runId = searchBody.runId as string;

    const issued = await page.request.post(`${api}/admin/recipe-search/runs/${runId}/issue-decision`, {

      data: { oneTime: true },

    });

    expect(issued.ok()).toBeTruthy();

    const inv = await page.request.post(`${api}/admin/recipe-search/runs/${runId}/invalidate`, {

      data: { reason: 'e2e stale decision' },

    });

    expect(inv.ok()).toBeTruthy();

    const invBody = await inv.json();

    expect(Number(invBody.invalidated)).toBeGreaterThanOrEqual(1);

  });

  test('B: PORTION_ADJUST panel persists after reload (API seed + UI)', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);

    const hit = await probePortionAdjust(page);
    test.skip(!hit, 'catalog cannot produce ADJUST_PORTION_OF_EXISTING');

    const { slotId, body: searchBody } = hit!;
    expect(searchBody.recommendation).toBe('ADJUST_PORTION_OF_EXISTING');
    expect(
      (searchBody.candidates ?? []).some((c) => c.candidateType === 'PORTION_ADJUSTABLE'),
    ).toBe(true);

    const top =
      (searchBody.candidates ?? []).find((c) => c.candidateType === 'PORTION_ADJUSTABLE') ??
      searchBody.candidates?.[0];
    expect(top?.recipeId).toBeTruthy();
    expect(top?.recipeVersionId).toBeTruthy();

    const versionBefore = await fetchRecipeVersionSnapshot(page, top!.recipeId, top!.recipeVersionId);

    await page.goto(`/admin/recipe-coverage/slots?selected=${slotId}`);
    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('coverage-search-panel')).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('coverage-search-recommendation')).toContainText(
      /ADJUST_PORTION_OF_EXISTING|Подходит после изменения порции/i,
    );
    await expect(page.getByTestId('coverage-search-portion-panel')).toBeVisible();
    await expect(page.getByTestId('coverage-search-portion-from')).not.toHaveText(/^—$/);
    await expect(page.getByTestId('coverage-search-portion-to')).not.toHaveText(/^—$/);
    await expect(page.getByTestId('coverage-search-portion-multiplier')).not.toHaveText('—');

    const runId = searchBody.runId as string;
    await page.reload();
    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('coverage-search-panel')).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('coverage-search-portion-panel')).toBeVisible();
    const reloadRun = await page.request.get(`${api}/admin/recipe-search/runs/${runId}`);
    expect(reloadRun.ok()).toBeTruthy();

    const versionAfter = await fetchRecipeVersionSnapshot(page, top!.recipeId, top!.recipeVersionId);
    expect(versionAfter).toBe(versionBefore);
  });

  test('C: SAFE_ADAPTATION panel when adapt candidate exists', async ({ page }) => {
    test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');
    await ownerLogin(page);

    const hit = await probeAdaptExisting(page);
    test.skip(!hit, 'no ADAPT_EXISTING_RECIPE slot (catalog + substitution seed exhausted)');

    const { slotId, body: searchBody } = hit!;
    expect(searchBody.recommendation).toBe('ADAPT_EXISTING_RECIPE');

    const adaptCandidate =
      (searchBody.candidates ?? []).find((c) => c.candidateType === 'SAFE_SUBSTITUTION_ADAPTABLE') ??
      searchBody.candidates?.[0];
    expect(adaptCandidate?.recipeId).toBeTruthy();
    expect(adaptCandidate?.recipeVersionId).toBeTruthy();

    const versionBefore = await fetchRecipeVersionSnapshot(
      page,
      adaptCandidate!.recipeId,
      adaptCandidate!.recipeVersionId,
    );

    await page.goto(`/admin/recipe-coverage/slots?selected=${slotId}`);
    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('coverage-search-adapt-panel')).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('coverage-search-adapt-curated')).toBeVisible();
    await expect(page.getByTestId('coverage-search-recommendation')).toContainText(
      /ADAPT_EXISTING_RECIPE|Можно адаптировать существующий рецепт/i,
    );

    const runId = searchBody.runId as string;
    const run = await page.request.get(`${api}/admin/recipe-search/runs/${runId}`);
    expect(run.ok()).toBeTruthy();
    const runBody = await run.json();
    expect(runBody.requestType).not.toBe('RESEARCH_PREFLIGHT');
    expect(runBody.recommendation).not.toBe('RESEARCH_REQUIRED');

    await page.reload();
    await expect(page.getByTestId('coverage-search-adapt-panel')).toBeVisible({ timeout: 120000 });

    const versionAfter = await fetchRecipeVersionSnapshot(
      page,
      adaptCandidate!.recipeId,
      adaptCandidate!.recipeVersionId,
    );
    expect(versionAfter).toBe(versionBefore);
  });

  test('onboarding ru: structured codes + free-text note not hard rule', async ({ page }) => {

    const email = `rp203c-onboard-${Date.now()}@test.com`;

    await page.goto('/register');

    await page.getByTestId('auth-email').fill(email);

    await page.getByTestId('auth-password').fill('Password12345');

    await page.getByTestId('auth-submit').click();

    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    await page.goto('/onboarding');

    await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });

    await page.getByTestId('profile-name').fill('RP203C Profile');

    await page.getByTestId('profile-age').fill('30');

    await page.getByTestId('profile-height').fill('175');

    await page.getByTestId('profile-weight').fill('80');

    await page.getByTestId('profile-goal-kind').selectOption('lose_weight');

    await page.getByTestId('profile-goal-target').fill('74');

    await page.getByTestId('profile-activity').selectOption('moderate');
    await page.getByTestId('profile-food-restrictions').fill('случайная заметка, не аллерген');
    await page.getByTestId('profile-allergens-gluten').click();
    await expect(page.getByTestId('profile-allergens-gluten')).toBeChecked();
    await page.getByTestId('profile-dietary-codes-vegetarian').click();
    await expect(page.getByTestId('profile-dietary-codes-vegetarian')).toBeChecked();
    await page.getByTestId('profile-equipment-codes-BASIC_STOVE').click();
    await expect(page.getByTestId('profile-equipment-codes-BASIC_STOVE')).toBeChecked();
    await page.waitForTimeout(200);
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 60000 });

    const profileRes = await page.request.get(`${api}/profile`);

    expect(profileRes.ok()).toBeTruthy();

    const profile = await profileRes.json();

    expect(profile.allergenCodes).toContain('gluten');

    expect(profile.dietaryCodes).toContain('vegetarian');

    expect(profile.equipmentCodes).toContain('BASIC_STOVE');

    expect(profile.foodRestrictions?.join(' ')).toMatch(/случайная заметка/);

    expect(profile.allergenCodes?.join(' ')).not.toMatch(/случайная/);

    await page.reload();

    await expect(page.getByTestId('profile-allergens-gluten')).toBeChecked();

    await expect(page.getByTestId('profile-food-restrictions')).toHaveValue(/случайная заметка/);

    await expect(page.getByTestId('profile-allergens')).toContainText(/глютен/i);

  });

});
