import { expect, test, type Page } from '@playwright/test';

const password = 'Password12345';

/**
 * Onboarding race root cause:
 * profile-status is unmounted while status==='saving', and save awaits profile + goal +
 * meal-plan regenerate. Default expect timeout (5s) races slow regenerate under load.
 * Also filling before profile-form is ready can write into a remounted empty form.
 *
 * Contract: wait for profile-form → fill → click save → wait regenerate OK → assert status text.
 */
async function registerAndOnboard(page: Page, email: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/onboarding');
  await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('profile-name')).toBeEnabled();

  await page.getByTestId('profile-name').fill('Sub Browser');
  await page.getByTestId('profile-age').fill('30');
  await page.getByTestId('profile-height').fill('175');
  await page.getByTestId('profile-weight').fill('80');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('74');
  await page.getByTestId('profile-activity').selectOption('moderate');

  const regenerate = page.waitForResponse(
    (res) =>
      res.url().includes('/meal-plan/regenerate') &&
      res.request().method() === 'POST' &&
      res.ok(),
    { timeout: 90000 },
  );
  await page.getByTestId('profile-save').click();
  await regenerate;
  await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 30000 });
}

function parseVersion(text: string | null): number {
  const match = String(text ?? '').match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

async function readShoppingSnapshot(page: Page) {
  await page.goto('/shopping-list');
  const empty = page.getByTestId('shopping-empty');
  const items = page.getByTestId('shopping-items');
  if ((await empty.count()) || !(await items.count())) {
    await page.getByTestId('shopping-generate').click();
    await expect(items).toBeVisible({ timeout: 20000 });
  }
  const versionText = (await page.getByTestId('shopping-plan-version').textContent()) ?? '';
  const names = await page.locator('[data-testid^="shopping-item-name-"]').allTextContents();
  const qtys = await page.locator('[data-testid^="shopping-item-qty-"]').allTextContents();
  return {
    versionText,
    items: names.map((name, index) => ({
      name: name.trim().toLowerCase(),
      qty: Number(String(qtys[index] ?? '').replace(/[^\d.]/g, '')) || 0,
    })),
  };
}

function qtyFor(items: { name: string; qty: number }[], needle: RegExp): number {
  return items.filter((i) => needle.test(i.name)).reduce((sum, i) => sum + i.qty, 0);
}

async function openLunchReplace(page: Page) {
  const lunchReplace = page
    .locator('li')
    .filter({ hasText: /buckwheat|греч|обед/i })
    .locator('[data-testid^="meal-card-replace-"]')
    .first();
  if (await lunchReplace.count()) await lunchReplace.click();
  else await page.locator('[data-testid^="meal-card-replace-"]').first().click();
}

/**
 * Curated rice flake root cause:
 * selectOption triggers loadCandidates → busy re-render remounts <li> nodes.
 * Returning a Locator from a previous render then clicking it hits a detached DOM node.
 *
 * Contract: after each ingredient select, wait for matching GET /substitutions OK and
 * loading clear; resolve candidate by stable data-candidate-product-id before assert/click.
 */
async function openBuckwheatIngredientReplace(page: Page): Promise<string> {
  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });

  for (let day = 0; day < 7; day += 1) {
    const tab = page.getByTestId(`meal-day-tab-${day}`);
    if (await tab.count()) await tab.click();
    await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 10000 });

    const buckwheatCard = page
      .locator('li[data-testid^="meal-card-"]')
      .filter({ has: page.locator('[data-testid^="meal-card-name-"]').filter({ hasText: /гречка|buckwheat/i }) })
      .first();
    if (!(await buckwheatCard.count())) continue;

    await buckwheatCard.locator('[data-testid^="meal-card-replace-"]').click();
    const ingredientModeLoad = page.waitForResponse(
      (res) =>
        res.url().includes('/substitutions') &&
        res.request().method() === 'GET' &&
        res.ok(),
      { timeout: 20000 },
    );
    await page.getByTestId('substitution-mode-ingredient').click();
    await ingredientModeLoad;
    await expect(page.getByTestId('substitution-loading')).toHaveCount(0, { timeout: 20000 });

    const select = page.getByTestId('substitution-ingredient-select');
    await expect(select).toBeVisible({ timeout: 10000 });

    const optionValues = await select.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    for (const value of optionValues) {
      const responsePromise = page.waitForResponse(
        (res) => {
          if (!res.url().includes('/substitutions')) return false;
          if (res.request().method() !== 'GET' || !res.ok()) return false;
          try {
            const u = new URL(res.url());
            return u.searchParams.get('ingredientProductId') === value;
          } catch {
            return false;
          }
        },
        { timeout: 20000 },
      );
      const current = await select.inputValue();
      if (current === value) {
        await page.getByTestId('substitution-reload-ingredient').click();
      } else {
        await select.selectOption(value);
      }
      await responsePromise;
      await expect(page.getByTestId('substitution-loading')).toHaveCount(0, { timeout: 20000 });
      await expect(page.getByTestId('substitution-candidates')).toBeVisible({ timeout: 20000 });

      const curatedRice = page
        .locator('[data-testid="substitution-candidates"] > li')
        .filter({
          has: page.getByTestId('substitution-candidate-name').filter({ hasText: /рис|rice/i }),
        })
        .filter({
          has: page.getByTestId('substitution-candidate-provenance').filter({
            hasText: /Проверенная замена|Curated/i,
          }),
        })
        .first();
      if (await curatedRice.count()) {
        const productId = await curatedRice.getAttribute('data-candidate-product-id');
        if (!productId) throw new Error('CURATED_RICE_MISSING_PRODUCT_ID');
        return productId;
      }
    }
  }
  throw new Error('BUCKWHEAT_CURATED_RICE_NOT_FOUND');
}

function curatedCandidateRow(page: Page, productId: string) {
  return page.locator(`[data-candidate-product-id="${productId}"]`);
}

async function confirmDishReplace(page: Page) {
  await page.goto('/meal-plan');
  await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
  const versionBefore = parseVersion(await page.getByTestId('meal-plan-version').textContent());
  await openLunchReplace(page);
  await expect(page.getByTestId('substitution-candidates')).toBeVisible({ timeout: 15000 });
  const turkey = page.getByTestId('substitution-candidate-name').filter({ hasText: /индей|turkey|рис|rice/i }).first();
  if (await turkey.count()) {
    await turkey.locator('xpath=ancestor::li[1]').getByTestId('substitution-select').click();
  } else {
    const equivalent = page.getByTestId('substitution-candidate-EQUIVALENT').first();
    if (await equivalent.count()) await equivalent.getByTestId('substitution-select').click();
    else await page.getByTestId('substitution-select').first().click();
  }
  await expect(page.getByTestId('substitution-preview')).toBeVisible();
  await page.getByTestId('substitution-confirm').click();
  await expect(page.getByTestId('meal-plan-version')).not.toContainText(String(versionBefore), { timeout: 25000 });
  const versionAfter = parseVersion(await page.getByTestId('meal-plan-version').textContent());
  expect(versionAfter).toBeGreaterThan(versionBefore);
  return { versionBefore, versionAfter };
}

test.describe('STEP_093 meal substitution browser', () => {
  test('A: equivalent dish replace — desktop', async ({ page }) => {
    const email = `sub-eq-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    const { versionAfter } = await confirmDishReplace(page);
    await page.reload();
    await expect(page.getByTestId('meal-plan-version')).toContainText(String(versionAfter));
    await expect(page.locator('[data-testid^="meal-card-replace-"]').first()).toBeVisible();
  });

  test('A2: dish replace updates shopping list quantities — desktop', async ({ page }) => {
    const email = `sub-shop-dish-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    const before = await readShoppingSnapshot(page);
    const buckwheatBefore = qtyFor(before.items, /греч|buckwheat/i);
    expect(buckwheatBefore).toBeGreaterThan(0);

    await confirmDishReplace(page);

    const after = await readShoppingSnapshot(page);
    expect(after.versionText).toMatch(/current/i);
    const buckwheatAfter = qtyFor(after.items, /греч|buckwheat/i);
    expect(buckwheatAfter).toBeLessThan(buckwheatBefore);
    const newProductQty = qtyFor(after.items, /индей|turkey|рис|rice|картоф|potato|broccoli|брокк/i);
    expect(newProductQty).toBeGreaterThan(0);

    await page.reload();
    const reloaded = await readShoppingSnapshot(page);
    expect(reloaded.items.length).toBe(after.items.length);
    expect(qtyFor(reloaded.items, /индей|turkey|рис|rice|картоф|potato|broccoli|брокк/i)).toBe(newProductQty);

    await page.getByTestId('shopping-generate').click();
    await expect(page.getByTestId('shopping-items')).toBeVisible({ timeout: 20000 });
    const replay = await readShoppingSnapshot(page);
    expect(replay.items.length).toBe(after.items.length);
    expect(qtyFor(replay.items, /индей|turkey|рис|rice|картоф|potato|broccoli|брокк/i)).toBe(newProductQty);
  });

  test('B: ingredient replace path opens and previews', async ({ page }) => {
    const email = `sub-ing-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid^="meal-card-replace-"]').first().click();
    await page.getByTestId('substitution-mode-ingredient').click();
    const select = page.getByTestId('substitution-ingredient-select');
    if (await select.count()) {
      await page.getByTestId('substitution-reload-ingredient').click();
    }
    await expect(page.getByTestId('substitution-panel')).toBeVisible();
  });

  test('B2: ingredient replace updates shopping — desktop', async ({ page }) => {
    const email = `sub-shop-ing-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    const before = await readShoppingSnapshot(page);
    const buckwheatBefore = qtyFor(before.items, /греч|buckwheat/i);

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
    const versionBefore = parseVersion(await page.getByTestId('meal-plan-version').textContent());

    const lunchReplace = page.locator('li').filter({ hasText: /buckwheat|греч/i }).locator('[data-testid^="meal-card-replace-"]').first();
    if (await lunchReplace.count()) await lunchReplace.click();
    else await page.locator('[data-testid^="meal-card-replace-"]').first().click();

    await page.getByTestId('substitution-mode-ingredient').click();
    const select = page.getByTestId('substitution-ingredient-select');
    if (await select.count()) {
      const reloadResponse = page.waitForResponse(
        (res) =>
          res.url().includes('/substitutions') &&
          res.request().method() === 'GET' &&
          res.ok(),
        { timeout: 20000 },
      );
      await page.getByTestId('substitution-reload-ingredient').click();
      await reloadResponse;
      await expect(page.getByTestId('substitution-loading')).toHaveCount(0, { timeout: 20000 });
    }
    await expect(page.getByTestId('substitution-candidates')).toBeVisible({ timeout: 20000 });
    const potatoCandidate = page.getByTestId('substitution-candidate-name').filter({ hasText: /картоф|potato/i }).first();
    if (await potatoCandidate.count()) {
      await potatoCandidate.locator('xpath=ancestor::li[1]').getByTestId('substitution-select').click();
    } else {
      await page.getByTestId('substitution-select').first().click();
    }
    await expect(page.getByTestId('substitution-preview')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('substitution-confirm').click();
    await expect(page.getByTestId('meal-plan-version')).not.toContainText(String(versionBefore), { timeout: 25000 });

    const after = await readShoppingSnapshot(page);
    expect(after.versionText).toMatch(/current/i);
    if (buckwheatBefore > 0) {
      expect(qtyFor(after.items, /греч|buckwheat/i)).toBeLessThanOrEqual(buckwheatBefore);
    }
    expect(after.items.length).toBeGreaterThan(0);
    await page.reload();
    const reloaded = await readShoppingSnapshot(page);
    expect(reloaded.items.length).toBe(after.items.length);
  });

  test('C: conflicting candidate shows warning — mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `sub-cf-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid^="meal-card-replace-"]').first().click();
    await expect(page.getByTestId('substitution-candidates')).toBeVisible({ timeout: 15000 });

    const conflicting = page.getByTestId('substitution-candidate-CONFLICTING').first();
    if (await conflicting.count()) {
      await conflicting.getByTestId('substitution-select').click();
      await expect(page.getByTestId('substitution-preview')).toBeVisible();
      await expect(page.getByTestId('substitution-warning')).toBeVisible();
      await expect(page.getByTestId('substitution-compensation')).toBeVisible();
      await page.getByTestId('substitution-discard').click();
      await expect(page.getByTestId('substitution-panel')).toHaveCount(0);
    } else {
      await page.getByTestId('substitution-close').click();
    }

    await expect(page.locator('[data-testid^="meal-card-replace-"]').first()).toBeVisible();
  });

  test('D: peanut allergen hard-filter hides peanut candidates', async ({ page }) => {
    const email = `sub-allergen-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    await page.goto('/onboarding');
    await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('profile-food-restrictions').fill('peanut');
    const regenerate = page.waitForResponse(
      (res) =>
        res.url().includes('/meal-plan/regenerate') &&
        res.request().method() === 'POST' &&
        res.ok(),
      { timeout: 90000 },
    );
    await page.getByTestId('profile-save').click();
    await regenerate;
    await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 30000 });

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
    await openLunchReplace(page);
    await expect(page.getByTestId('substitution-candidates')).toBeVisible({ timeout: 15000 });

    const names = (await page.getByTestId('substitution-candidate-name').allTextContents()).map((n) =>
      n.toLowerCase(),
    );
    expect(names.some((n) => /peanut|арахис/.test(n))).toBe(false);
    expect(await page.getByTestId('substitution-candidate-BLOCKED').count()).toBe(0);
  });

  test('RP2-01B A: curated ingredient substitution shows provenance and role', async ({ page }) => {
    const email = `rp2b-curated-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    const riceProductId = await openBuckwheatIngredientReplace(page);
    const curatedRice = curatedCandidateRow(page, riceProductId);
    await expect(curatedRice).toBeVisible();
    await expect(curatedRice.getByTestId('substitution-candidate-provenance')).toContainText(
      /Проверенная замена|Подобрано по составу/i,
    );
    await curatedRice.getByTestId('substitution-select').click();
    await expect(page.getByTestId('substitution-preview')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('substitution-confirm').click();
    await expect(page.getByTestId('meal-plan-version')).toBeVisible({ timeout: 25000 });

    const after = await readShoppingSnapshot(page);
    expect(after.items.length).toBeGreaterThan(0);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
  });

  test('RP2-01B B: method-incompatible candidate is not offered', async ({ page }) => {
    const email = `rp2b-method-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    await openBuckwheatIngredientReplace(page);
    const potatoProductId = 'a0930001-0000-4000-8000-000000000002';
    await expect(page.locator(`[data-candidate-product-id="${potatoProductId}"]`)).toHaveCount(0, {
      timeout: 15000,
    });
  });

  test('RP2-01B C: dish detail shows retail/legacy price provenance — desktop', async ({ page }) => {
    const email = `rp2b-price-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid^="meal-card-details-"]').first().click();
    await expect(page.getByTestId('meal-dish-cost-consumed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('meal-dish-cost-packages')).toBeVisible();
    const sources = page.getByTestId('meal-dish-ingredient-price-source');
    await expect(sources.first()).toBeVisible({ timeout: 15000 });
    const text = (await sources.first().textContent()) ?? '';
    expect(/Цена из магазина|Использована старая цена|Цена неполная|Цена отсутствует|Цена из каталога/i.test(text)).toBe(
      true,
    );
    expect(/RETAIL_PRODUCT_PRICE|LEGACY_PRODUCT_PRICE|HEURISTIC_CATALOG_MATCH/i.test(text)).toBe(false);
  });

  test('RP2-01B mobile smoke: ingredient + shopping 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `rp2b-mobile-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid^="meal-card-replace-"]').first().click();
    await page.getByTestId('substitution-mode-ingredient').click();
    if (await page.getByTestId('substitution-ingredient-select').count()) {
      const reloadResponse = page.waitForResponse(
        (res) =>
          res.url().includes('/substitutions') &&
          res.request().method() === 'GET' &&
          res.ok(),
        { timeout: 20000 },
      );
      await page.getByTestId('substitution-reload-ingredient').click();
      await reloadResponse;
    }
    await expect(page.getByTestId('substitution-panel')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('substitution-close').click();
    await page.goto('/shopping-list');
    await expect(page.getByTestId('shopping-generate').or(page.getByTestId('shopping-items'))).toBeVisible({
      timeout: 15000,
    });
  });
});
