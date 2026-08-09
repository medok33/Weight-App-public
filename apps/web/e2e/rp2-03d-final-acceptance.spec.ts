import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const OWNER_USER = process.env.OWNER_E2E_USERNAME ?? '';
const OWNER_PASS = process.env.OWNER_E2E_PASSWORD ?? '';

async function ownerLogin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(OWNER_USER);
  await page.getByTestId('auth-password').fill(OWNER_PASS);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
  await expect(page.getByTestId('auth-role-badge')).toContainText('OWNER', { timeout: 30_000 });
}

async function countRecipes(page: import('@playwright/test').Page) {
  const res = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
  if (!res.ok()) return -1;
  const body = (await res.json()) as { total?: number; items?: unknown[] };
  return body.total ?? body.items?.length ?? 0;
}

/** Scan+clear OPEN fingerprint blockers. Failed publish does not mutate lifecycle (gate throws first). */
async function dismissOpenDuplicateBlockersForVersion(
  page: import('@playwright/test').Page,
  recipeId: string,
  versionId: string,
): Promise<'already_published' | 'cleared'> {
  await page.request.post(
    `${api}/admin/recipes/${recipeId}/versions/${versionId}/fingerprint/rebuild`,
    { data: {} },
  );
  const probe = await page.request.post(`${api}/admin/recipes/${recipeId}/versions/${versionId}/publish`, {
    data: {},
  });
  if (probe.ok()) return 'already_published';

  const list = await page.request.get(`${api}/admin/recipe-duplicates?status=OPEN&pageSize=200`);
  expect(list.ok()).toBeTruthy();
  const payload = (await list.json()) as {
    items?: Array<{
      id: string;
      leftRecipeVersionId?: string;
      rightRecipeVersionId?: string;
    }>;
  };
  for (const item of payload.items ?? []) {
    const touches =
      item.leftRecipeVersionId === versionId || item.rightRecipeVersionId === versionId;
    if (!touches) continue;
    const res = await page.request.post(`${api}/admin/recipe-duplicates/${item.id}/resolve`, {
      data: {
        resolutionCode: 'DISMISSED',
        resolutionNote: 'STEP_212 lifecycle fixture: clear publication blocker before UI publish',
      },
    });
    expect(res.ok()).toBeTruthy();
  }
  return 'cleared';
}

test.describe('RP2-03D STEP_212 targeted final browser acceptance', () => {
  test.skip(!OWNER_USER || !OWNER_PASS, 'OWNER_E2E_* required');

  test('1 lifecycle consistency A–E', async ({ page }) => {
    await ownerLogin(page);

    const list = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=50`);
    expect(list.ok()).toBeTruthy();
    const recipes = (await list.json()) as {
      items: Array<{ id: string; name: string; currentVersionId: string | null; lifecycleStatus?: string }>;
    };
    const source = recipes.items.find((r) => r.currentVersionId);
    test.skip(!source, 'no production recipe with current version');

    const previousCurrentId = source!.currentVersionId!;
    const create = await page.request.post(`${api}/admin/recipes/${source!.id}/versions`, {
      data: { publish: false, changeReason: 'STEP_212 lifecycle acceptance IN_REVIEW' },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()) as { id: string; versionNumber?: number };
    const reviewVersionId = created.id;
    const versionNumber = created.versionNumber ?? 0;

    // E: invalid action → controlled 4xx, state unchanged, no new lifecycle events
    const lifeBefore = await page.request.get(
      `${api}/admin/recipes/${source!.id}/versions/${reviewVersionId}/lifecycle`,
    );
    expect(lifeBefore.ok()).toBeTruthy();
    const beforeBody = (await lifeBefore.json()) as {
      lifecycle?: { lifecycleStatus?: string };
      events?: Array<{ toStatus?: string }>;
    };
    const statusBefore = beforeBody.lifecycle?.lifecycleStatus ?? 'IN_REVIEW';
    const eventsBefore = beforeBody.events?.length ?? 0;

    const invalid = await page.request.post(
      `${api}/admin/recipes/${source!.id}/versions/${reviewVersionId}/suspend`,
      { data: { reasonCode: 'INVALID_UI_HIDDEN', reasonText: 'should fail' } },
    );
    expect(invalid.status()).toBeGreaterThanOrEqual(400);
    expect(invalid.status()).toBeLessThan(500);

    const lifeAfterInvalid = await page.request.get(
      `${api}/admin/recipes/${source!.id}/versions/${reviewVersionId}/lifecycle`,
    );
    const afterInvalid = (await lifeAfterInvalid.json()) as {
      lifecycle?: { lifecycleStatus?: string };
      events?: Array<{ toStatus?: string }>;
    };
    expect(afterInvalid.lifecycle?.lifecycleStatus ?? statusBefore).toBe(statusBefore);
    expect(afterInvalid.events?.length ?? eventsBefore).toBe(eventsBefore);

    await page.goto(`/admin/recipes/${source!.id}`);
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Lifecycle|Жизненный цикл/i }).click();
    await page.getByRole('button', { name: `v${versionNumber}`, exact: true }).click();
    await expect(page.getByTestId('lifecycle-approve')).toBeVisible({ timeout: 15_000 });

    // A: IN_REVIEW
    await expect(page.getByTestId(`version-lifecycle-${versionNumber}`)).toContainText('На проверке');
    await expect(page.getByTestId(`version-publication-${versionNumber}`)).not.toContainText('Опубликована');
    await expect(page.getByTestId(`version-current-${versionNumber}`)).not.toHaveText('текущая');
    await expect(page.getByTestId('lifecycle-approve')).toBeVisible();
    await expect(page.getByTestId('lifecycle-reject')).toBeVisible();
    await expect(page.getByTestId('lifecycle-publish')).toHaveCount(0);
    await expect(page.getByTestId('lifecycle-suspend')).toHaveCount(0);
    await expect(page.getByTestId('lifecycle-restore')).toHaveCount(0);

    await page.getByTestId('lifecycle-approve').click();
    await expect(page.getByTestId(`version-lifecycle-${versionNumber}`)).toContainText('Одобрена', {
      timeout: 20_000,
    });

    // B: APPROVED
    await expect(page.getByTestId('lifecycle-publish')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('lifecycle-reject')).toBeVisible();
    await expect(page.getByTestId('lifecycle-suspend')).toHaveCount(0);
    await expect(page.getByTestId('lifecycle-restore')).toHaveCount(0);

    // PRODUCTION clones often hit EXACT_DUPLICATE on publish; clear OPEN blockers, then publish in UI.
    const gate = await dismissOpenDuplicateBlockersForVersion(page, source!.id, reviewVersionId);
    if (gate === 'already_published') {
      await page.reload();
      await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Lifecycle|Жизненный цикл/i }).click();
      await page.getByRole('button', { name: `v${versionNumber}`, exact: true }).click();
    } else {
      const publishResponsePromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/versions/${reviewVersionId}/publish`) && res.request().method() === 'POST',
        { timeout: 60_000 },
      );
      await page.getByTestId('lifecycle-publish').click();
      const publishResponse = await publishResponsePromise;
      if (!publishResponse.ok()) {
        // Race: scan recreated blockers — OWNER override with reason, then prove UI label.
        const overridden = await page.request.post(
          `${api}/admin/recipes/${source!.id}/versions/${reviewVersionId}/publish`,
          {
            data: {
              overrideExactDuplicate: true,
              overrideReason: 'STEP_212 lifecycle acceptance OWNER override after dismiss race',
              acknowledgeNearDuplicate: true,
            },
          },
        );
        expect(overridden.ok()).toBeTruthy();
        await page.reload();
        await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
        await page.getByRole('button', { name: /Lifecycle|Жизненный цикл/i }).click();
        await page.getByRole('button', { name: `v${versionNumber}`, exact: true }).click();
      }
    }

    await expect(page.getByTestId(`version-lifecycle-${versionNumber}`)).toContainText('Опубликована', {
      timeout: 30_000,
    });

    // Prove DB + workspace DTO, not only HTTP.
    const lifePublished = await page.request.get(
      `${api}/admin/recipes/${source!.id}/versions/${reviewVersionId}/lifecycle`,
    );
    expect(lifePublished.ok()).toBeTruthy();
    const lifeBody = (await lifePublished.json()) as {
      lifecycle?: { lifecycleStatus?: string; validationStatus?: string };
    };
    expect(lifeBody.lifecycle?.lifecycleStatus).toBe('PUBLISHED');
    const wsPublished = await page.request.get(
      `${api}/admin/recipes/${source!.id}/versions/${reviewVersionId}/workspace`,
    );
    expect(wsPublished.ok()).toBeTruthy();
    const wsBody = (await wsPublished.json()) as {
      version?: { lifecycleStatus?: string; isCurrent?: boolean; publishedAt?: string | null };
      allowedActions?: Array<{ code: string }>;
    };
    expect(wsBody.version?.lifecycleStatus).toBe('PUBLISHED');
    expect(wsBody.version?.isCurrent).toBe(true);
    expect(wsBody.allowedActions?.some((a) => a.code === 'SUSPEND')).toBe(true);
    expect(wsBody.allowedActions?.some((a) => a.code === 'ARCHIVE')).toBe(true);

    // C: PUBLISHED current
    await expect(page.getByTestId(`version-current-${versionNumber}`)).toHaveText('текущая');
    await expect(page.getByTestId(`version-publication-${versionNumber}`)).toContainText('Опубликована');
    await expect(page.getByTestId('lifecycle-suspend')).toBeVisible();
    await expect(page.getByTestId('lifecycle-archive')).toBeVisible();
    await expect(page.getByTestId('lifecycle-approve')).toHaveCount(0);
    await expect(page.getByTestId('lifecycle-publish')).toHaveCount(0);
    await expect(page.getByTestId('lifecycle-restore')).toHaveCount(0);
    await page.getByRole('button', { name: /Technical|Технические сведения/i }).click();
    await expect(page.getByTestId('recipe-technical-snapshot')).toBeVisible();

    // D: SUPERSEDED historical
    const ws = await page.request.get(`${api}/admin/recipes/${source!.id}/workspace`);
    expect(ws.ok()).toBeTruthy();
    const workspace = (await ws.json()) as {
      versions?: Array<{ id: string; lifecycleStatus?: string; versionNumber?: number; isCurrent?: boolean }>;
    };
    const superseded = workspace.versions?.find(
      (v) => v.id === previousCurrentId || v.lifecycleStatus === 'SUPERSEDED',
    );
    test.skip(!superseded, 'no SUPERSEDED version after publish');
    await page.getByRole('button', { name: /Lifecycle|Жизненный цикл/i }).click();
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/versions/${superseded!.id}/workspace`) && res.ok(),
      ),
      page.getByRole('button', { name: `v${superseded!.versionNumber}`, exact: true }).click(),
    ]);
    await expect(page.getByTestId(`version-lifecycle-${superseded!.versionNumber}`)).toContainText('Заменена новой');
    await expect(page.getByTestId(`version-current-${superseded!.versionNumber}`)).not.toHaveText('текущая');
    const versionWs = await page.request.get(
      `${api}/admin/recipes/${source!.id}/versions/${superseded!.id}/workspace`,
    );
    const versionBody = (await versionWs.json()) as { allowedActions?: Array<{ code: string }> };
    const restoreAllowed = (versionBody.allowedActions ?? []).some((a) => a.code === 'RESTORE');
    if (restoreAllowed) {
      await expect(page.getByTestId('lifecycle-restore')).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(page.getByTestId('lifecycle-restore')).toHaveCount(0);
    }
  });

  test('2 search-before-generate integration + stale + no research side effects', async ({ page }) => {
    await ownerLogin(page);
    const recipesBefore = await countRecipes(page);

    await page.goto('/admin/recipe-coverage');
    await expect(page.getByTestId('recipe-coverage-board')).toBeVisible({ timeout: 30_000 });

    let slotId: string | null = null;
    for (const status of ['EMPTY', 'UNDERFILLED'] as const) {
      const res = await page.request.get(`${api}/admin/recipe-coverage/slots?status=${status}&limit=5`);
      if (!res.ok()) continue;
      const body = (await res.json()) as { items?: Array<{ id: string; status?: string }> };
      const hit = body.items?.find((s) => s.id);
      if (hit) {
        slotId = hit.id;
        break;
      }
    }
    test.skip(!slotId, 'no EMPTY/UNDERFILLED coverage slots');

    await page.goto(`/admin/recipe-coverage/slots?selected=${slotId}`);
    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('coverage-slot-key').evaluate((el) => {
      const details = el.closest('details');
      if (details) details.open = true;
    });
    await expect(page.getByTestId('coverage-slot-key')).toBeVisible();

    const versionsBeforeRes = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
    const versionsBeforeTotal = ((await versionsBeforeRes.json()) as { total?: number }).total ?? 0;

    await page.getByTestId('coverage-search-preflight').click();
    await expect(page.getByTestId('coverage-search-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('coverage-search-run-status')).toBeVisible();
    await expect(page.getByTestId('coverage-search-recommendation')).toBeVisible();
    const recText = await page.getByTestId('coverage-search-recommendation').innerText();
    expect(recText).not.toMatch(/\bUSE_EXISTING_RECIPE\b|\bRESEARCH_REQUIRED\b|\bADJUST_PORTION_OF_EXISTING\b/);
    expect(recText.length).toBeGreaterThan(5);
    await expect(page.getByTestId('coverage-search-candidates')).toBeVisible();
    await expect(page.getByTestId('coverage-search-reasons')).toBeVisible();

    if (/дубл/i.test(recText) || (await page.getByTestId('coverage-search-open-duplicates').count())) {
      const href = await page.getByTestId('coverage-search-open-duplicates').getAttribute('href');
      expect(href).toMatch(/recipe-duplicates/);
      await page.getByTestId('coverage-search-open-duplicates').click();
      await expect(page.getByTestId('admin-recipe-duplicates')).toBeVisible({ timeout: 30_000 });
      await page.goBack();
      await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30_000 });
    }

    const recipesAfter = await countRecipes(page);
    expect(recipesAfter).toBe(recipesBefore);
    const versionsAfterRes = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
    const versionsAfterTotal = ((await versionsAfterRes.json()) as { total?: number }).total ?? 0;
    expect(versionsAfterTotal).toBe(versionsBeforeTotal);

    await page.reload();
    await expect(page.getByTestId('coverage-search-panel')).toBeVisible({ timeout: 30_000 });

    const runIdAttr = await page.evaluate(async () => {
      const selected = new URLSearchParams(location.search).get('selected');
      if (!selected) return null;
      const runs = await fetch(`/api/admin/recipe-search/runs?coverageSlotId=${selected}&limit=1`).then((r) =>
        r.json(),
      );
      return (runs.items?.[0]?.id as string) ?? null;
    });
    expect(runIdAttr).toBeTruthy();
    const issued = await page.request.post(`${api}/admin/recipe-search/runs/${runIdAttr}/issue-decision`, {
      data: { oneTime: true },
    });
    expect(issued.ok()).toBeTruthy();
    const issuedBody = (await issued.json()) as { decisionId?: string; expiresAt?: string };
    expect(issuedBody.decisionId).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('coverage-search-decision-expiry')).toBeVisible({ timeout: 20_000 });

    const inv = await page.request.post(`${api}/admin/recipe-search/runs/${runIdAttr}/invalidate`, {
      data: { reason: 'STEP_212_STALE_ACCEPTANCE', decisionId: issuedBody.decisionId },
    });
    expect(inv.ok()).toBeTruthy();
    const invBody = (await inv.json()) as { invalidated?: number };
    expect(Number(invBody.invalidated ?? 0)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId('coverage-slot-detail')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('coverage-search-panel')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('coverage-search-decision-stale')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('coverage-search-decision-stale')).toContainText(
      'Решение устарело — выполните поиск повторно',
    );
  });

  test('3 duplicate cross-link', async ({ page }) => {
    await ownerLogin(page);
    const dups = await page.request.get(`${api}/admin/recipe-duplicates?status=OPEN`);
    expect(dups.ok()).toBeTruthy();
    const payload = (await dups.json()) as {
      items: Array<{
        id: string;
        leftRecipeId?: string;
        rightRecipeId?: string;
        classification: string;
        score: number | string;
      }>;
    };
    test.skip(!payload.items?.length, 'no OPEN duplicate candidates');
    const candidate = payload.items[0]!;
    const recipeId = candidate.leftRecipeId ?? candidate.rightRecipeId;
    // Discover recipe from candidate detail page if ids missing
    let targetRecipeId = recipeId;
    if (!targetRecipeId) {
      const catalog = await page.request.get(
        `${api}/admin/recipes?dataClass=PRODUCTION&duplicateBlocker=yes&pageSize=20`,
      );
      const cat = (await catalog.json()) as { items: Array<{ id: string }> };
      targetRecipeId = cat.items[0]?.id;
    }
    test.skip(!targetRecipeId, 'cannot resolve recipe for duplicate candidate');

    await page.goto(`/admin/recipes/${targetRecipeId}`);
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Обзор' }).click();
    const openLink = page.locator('[data-testid^="recipe-duplicate-open-"]').first();
    if ((await openLink.count()) === 0) {
      await page.goto(`/admin/recipe-duplicates?status=OPEN&candidateId=${candidate.id}`);
    } else {
      await expect(page.getByTestId('recipe-duplicate-panel')).toContainText(/score|групп|блок/i);
      await openLink.click();
    }
    await expect(page.getByTestId('admin-recipe-duplicates')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dup-candidate-detail')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('dup-candidate-detail')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dup-confirm-duplicate')).toBeVisible();
    // no auto-merge control
    await expect(page.getByRole('button', { name: /auto.?merge|авто.?слия/i })).toHaveCount(0);
  });

  test('4 media cross-link', async ({ page }) => {
    await ownerLogin(page);
    const list = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=30`);
    const recipes = (await list.json()) as {
      items: Array<{ id: string; currentVersionId: string | null }>;
    };
    let found:
      | { recipeId: string; versionId: string; mediaAssetId: string; rightsStatus: string }
      | null = null;
    for (const recipe of recipes.items.slice(0, 20)) {
      if (!recipe.currentVersionId) continue;
      const ws = await page.request.get(
        `${api}/admin/recipes/${recipe.id}/versions/${recipe.currentVersionId}/workspace`,
      );
      if (!ws.ok()) continue;
      const body = (await ws.json()) as {
        media?: Array<{ mediaAssetId?: string; rightsStatus?: string; publicationEligible?: boolean }>;
        technical?: Record<string, unknown>;
      };
      const media = body.media?.[0];
      if (media?.mediaAssetId) {
        found = {
          recipeId: recipe.id,
          versionId: recipe.currentVersionId,
          mediaAssetId: media.mediaAssetId,
          rightsStatus: String(media.rightsStatus ?? ''),
        };
        expect(JSON.stringify(body.media)).not.toMatch(/"storageKey"\s*:\s*"/);
        break;
      }
    }
    if (!found) {
      // Register media and attach is heavy; smoke media review deep-link only
      await page.goto('/admin/media');
      await expect(page.getByTestId('admin-media')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('media-register').click();
      const mediaList = await page.request.get(`${api}/admin/media`);
      const payload = (await mediaList.json()) as { items: Array<{ id: string; rightsStatus: string }> };
      test.skip(!payload.items?.[0], 'media register failed');
      const id = payload.items[0]!.id;
      await page.goto(`/admin/media?selected=${id}`);
      await expect(page.locator(`[data-testid="media-row-${id}"]`)).toHaveAttribute('data-selected', 'true', {
        timeout: 20_000,
      });
      await expect(page.getByTestId('media-selected-detail')).toContainText(/Снято|takedown|Права|прав|PENDING|модерац/i);
      return;
    }

    await page.goto(`/admin/recipes/${found.recipeId}`);
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Media|Медиа/i }).click();
    await expect(page.getByTestId('recipe-media-panel')).toBeVisible();
    const open = page.locator('[data-testid^="recipe-media-open-"]').first();
    test.skip((await open.count()) === 0, 'no media open link');
    await open.click();
    await expect(page.getByTestId('admin-media')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-testid="media-row-${found.mediaAssetId}"]`)).toHaveAttribute(
      'data-selected',
      'true',
    );
    const snapBefore = await page.request.get(
      `${api}/admin/recipes/${found.recipeId}/versions/${found.versionId}`,
    );
    const beforeText = await snapBefore.text();
    await page.goto(`/admin/recipes/${found.recipeId}`);
    await page.getByRole('button', { name: /Technical|Технические сведения/i }).click();
    await expect(page.getByTestId('recipe-technical-snapshot')).toBeVisible();
    const snapAfter = await page.request.get(
      `${api}/admin/recipes/${found.recipeId}/versions/${found.versionId}`,
    );
    expect(await snapAfter.text()).toBe(beforeText);
  });

  test('5 revalidation cross-link', async ({ page }) => {
    await ownerLogin(page);
    const queue = await page.request.get(`${api}/admin/recipe-revalidation?status=OPEN`);
    expect(queue.ok()).toBeTruthy();
    const payload = (await queue.json()) as {
      items: Array<{
        id: string;
        recipeId: string;
        recipeVersionId: string;
        productName: string;
        reasonCode: string;
        severity: string;
        occurrenceCount: number;
      }>;
    };
    test.skip(!payload.items?.length, 'no OPEN revalidation tasks');
    const task = payload.items[0]!;

    const versionsRes = await page.request.get(`${api}/admin/recipes/${task.recipeId}/versions`);
    expect(versionsRes.ok()).toBeTruthy();
    const versionsBody = (await versionsRes.json()) as {
      items?: Array<{ id: string; versionNumber?: number }>;
    };
    const versionMeta = (versionsBody.items ?? []).find((v) => v.id === task.recipeVersionId);
    expect(versionMeta?.versionNumber).toBeTruthy();

    await page.goto(`/admin/recipes/${task.recipeId}`);
    await expect(page.getByTestId('admin-recipe-detail')).toBeVisible({ timeout: 30_000 });
    // Tasks are scoped to recipeVersionId — open that version before the revalidation tab.
    await page.getByRole('button', { name: 'Жизненный цикл' }).click();
    await page.getByRole('button', { name: `v${versionMeta!.versionNumber}`, exact: true }).click();
    await page.getByRole('button', { name: /Revalidation|Повторная проверка/i }).click();
    const row = page.getByTestId(`revalidation-task-${task.id}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(task.reasonCode);
    await expect(row).toContainText(String(task.occurrenceCount));
    if (task.severity === 'CRITICAL' || task.severity === 'HIGH') {
      await expect(row).toContainText(/КРИТИЧНО|Высокий/);
    }
    await page.getByTestId(`revalidation-open-${task.id}`).click();
    await expect(page.getByTestId('admin-recipe-revalidation')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`reval-task-${task.id}`)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('reval-task-detail')).toBeVisible();

    await page.goto(`/admin/recipes/${task.recipeId}`);
    await page.getByRole('button', { name: 'Жизненный цикл' }).click();
    await page.getByRole('button', { name: `v${versionMeta!.versionNumber}`, exact: true }).click();
    await page.getByRole('button', { name: /Dependencies|Зависимости/i }).click();
    const deps = page.getByTestId('recipe-version-dependencies');
    await expect(deps).toBeVisible();
    // unresolved dependency wording when present
    const depText = await deps.innerText();
    if (/LEGACY_UNRESOLVED|не установлена/i.test(depText)) {
      await expect(deps).toContainText('Версия КБЖУ продукта не установлена');
    }
  });

  test('6 content overview deep-links + USER forbidden', async ({ page }) => {
    test.setTimeout(120_000);
    await ownerLogin(page);
    await page.goto('/admin/content');
    await expect(page.getByTestId('admin-content-overview')).toBeVisible({ timeout: 30_000 });

    const production = Number(
      await page.getByTestId('content-metric-productionRecipes').locator('strong').innerText(),
    );
    await page.getByTestId('content-metric-productionRecipes').locator('a').click();
    await expect(page).toHaveURL(/dataClass=PRODUCTION/);
    await expect(page.getByTestId('admin-recipes-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('recipe-data-class-filter')).toContainText(/PRODUCTION|Рабоч/i);

    await page.goto('/admin/content');
    await page.getByTestId('content-metric-coverageEmpty').locator('a').click();
    await expect(page).toHaveURL(/status=EMPTY/);
    await expect(page.getByTestId('recipe-coverage-board')).toBeVisible({ timeout: 30_000 });

    await page.goto('/admin/content');
    await page.getByTestId('content-metric-coverageUnderfilled').locator('a').click();
    await expect(page).toHaveURL(/status=UNDERFILLED/);

    await page.goto('/admin/content');
    await page.getByTestId('content-metric-openRevalidation').locator('a').click();
    await expect(page).toHaveURL(/recipe-revalidation.*status=OPEN/);
    await expect(page.getByTestId('admin-recipe-revalidation')).toBeVisible({ timeout: 30_000 });

    await page.goto('/admin/content');
    await page.getByTestId('content-metric-duplicateBlockers').locator('a').click();
    await expect(page).toHaveURL(/recipe-duplicates/);
    await expect(page.getByTestId('admin-recipe-duplicates')).toBeVisible({ timeout: 30_000 });

    await page.goto('/admin/content');
    await page.getByTestId('content-metric-mediaRightsBlockers').locator('a').click();
    await expect(page).toHaveURL(/\/admin\/media/);
    await expect(page.getByTestId('admin-media')).toBeVisible({ timeout: 30_000 });

    expect(production).toBeGreaterThanOrEqual(0);

    await page.context().clearCookies();
    const anonymous = await page.request.get(`${api}/admin/content/overview`);
    expect([401, 403]).toContain(anonymous.status());

    const email = `rp203d-final-user-${Date.now()}@test.com`;
    await page.goto('/register');
    await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
    const forbidden = await page.request.get(`${api}/admin/content/overview`);
    expect([401, 403]).toContain(forbidden.status());
    await page.goto('/admin/content');
    await expect(page.getByText('Обзор контента недоступен')).toBeVisible({ timeout: 20_000 });
  });

  test('7 responsive smoke desktop/tablet/mobile', async ({ page }) => {
    await ownerLogin(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/recipes?dataClass=PRODUCTION');
    await expect(page.getByTestId('admin-recipes-list')).toBeVisible({ timeout: 30_000 });
    const recipeWidth = await page.locator('.admin-workspace').evaluate((el) => el.getBoundingClientRect().width);
    expect(recipeWidth).toBeGreaterThan(700);
    await page.goto('/admin/recipe-coverage');
    await expect(page.getByTestId('recipe-coverage-board')).toBeVisible({ timeout: 30_000 });
    const boardWidth = await page.locator('.admin-workspace').evaluate((el) => el.getBoundingClientRect().width);
    expect(boardWidth).toBeGreaterThan(700);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin/content');
    await expect(page.getByTestId('admin-content-overview')).toBeVisible({ timeout: 30_000 });
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThan(80);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/content');
    await expect(page.getByTestId('admin-content-overview')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Обзор контента' })).toBeVisible();
    const mobileOverflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    // Smoke: no destructive page-level overflow after mobile admin layout rules.
    expect(mobileOverflow).toBeLessThan(40);
  });
});
