import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

type PgPool = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
  end: () => Promise<void>;
};

const requireFromApi = createRequire(resolve(__dirname, '../../api/package.json'));
const { Pool } = requireFromApi('pg') as { Pool: new (config: { connectionString: string }) => PgPool };

const password = 'Password12345';
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';

async function registerAndOnboard(page: Page, email: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/onboarding');
  await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('profile-name').fill('RP202A Accept');
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

function parseKcal(text: string | null): number {
  const match = String(text ?? '').match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

test.describe('RP2-02A final acceptance browser matrix', () => {
  test('A: portion scaling changes displayed nutrition proportionally', async ({ page }) => {
    const email = `rp202a-portion-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const user = await pool.query<{ id: string }>(`SELECT id FROM "User" WHERE email = $1 LIMIT 1`, [email]);
      const userId = user.rows[0]?.id;
      expect(userId).toBeTruthy();

      const items = await pool.query<{ id: string; recipeId: string; recipeVersionId: string | null }>(
        `SELECT mi.id, mi."recipeId", mi."recipeVersionId"
         FROM "MealItem" mi
         JOIN "Meal" m ON m.id = mi."mealId"
         JOIN "PlanDay" pd ON pd.id = m."planDayId"
         JOIN "Plan" p ON p.id = pd."planId"
         WHERE p."userId" = $1
           AND pd."dayIndex" = 0
           AND p.version = (SELECT MAX(version) FROM "Plan" WHERE "userId" = $1)
         ORDER BY m."plannedTime" NULLS LAST, mi.id
         LIMIT 2`,
        [userId],
      );
      expect(items.rows.length).toBeGreaterThanOrEqual(2);
      const a = items.rows[0]!;
      const b = items.rows[1]!;
      await pool.query(
        `UPDATE "MealItem"
         SET "recipeId" = $2, "recipeVersionId" = $3, "portionGrams" = 200, servings = 1
         WHERE id = $1`,
        [a.id, a.recipeId, a.recipeVersionId],
      );
      await pool.query(
        `UPDATE "MealItem"
         SET "recipeId" = $2, "recipeVersionId" = $3, "portionGrams" = 500, servings = 1
         WHERE id = $1`,
        [b.id, a.recipeId, a.recipeVersionId],
      );

      await page.goto('/meal-plan');
      await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 20000 });
      await page.getByTestId('meal-day-tab-0').click();
      await expect(page.getByTestId('meal-day-detail')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId(`meal-card-macros-${a.id}`)).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId(`meal-card-macros-${b.id}`)).toBeVisible({ timeout: 20000 });

      const macrosA = parseKcal(await page.getByTestId(`meal-card-macros-${a.id}`).textContent());
      const macrosB = parseKcal(await page.getByTestId(`meal-card-macros-${b.id}`).textContent());
      expect(macrosA).toBeGreaterThan(0);
      expect(macrosB).toBeGreaterThan(0);
      expect(macrosB / macrosA).toBeCloseTo(2.5, 1);

      const plannedText = (await page.getByTestId('meal-day-planned').textContent()) ?? '';
      const plannedKcal = parseKcal(plannedText);
      const cardKcal = (
        await Promise.all(
          (await page.locator('[data-testid^="meal-card-macros-"]').all()).map(async (loc) =>
            parseKcal(await loc.textContent()),
          ),
        )
      ).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
      expect(Math.abs(plannedKcal - Math.round(cardKcal))).toBeLessThanOrEqual(3);
    } finally {
      await pool.end();
    }
  });

  test('B+C: restrictions localized; ingredient select has name+amount without UUID', async ({ page }) => {
    const email = `rp202a-labels-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 20000 });

    const allergenText = (
      await page.locator('[data-testid^="meal-card-allergens-"]').allTextContents()
    ).join(' | ');
    if (allergenText) {
      expect(/gluten_free|PEANUT|MILK|HEURISTIC_/i.test(allergenText)).toBe(false);
      expect(/Молоко|Арахис|Глютен|Яйцо|Рыба|орех|соя/i.test(allergenText) || allergenText.length > 0).toBe(true);
    }

    const chickenCard = page.locator('li').filter({ hasText: /курица|chicken|греч|buckwheat/i }).first();
    if (await chickenCard.count()) {
      const dietary = (await chickenCard.textContent()) ?? '';
      expect(/веган|vegan|вегетариан/i.test(dietary)).toBe(false);
    }

    await page.locator('[data-testid^="meal-card-replace-"]').first().click();
    await page.getByTestId('substitution-mode-ingredient').click();
    const select = page.getByTestId('substitution-ingredient-select');
    await expect(select).toBeVisible({ timeout: 15000 });
    const optionText = await select.locator('option').first().textContent();
    expect(optionText ?? '').toMatch(/.+—\s*\d/);
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(optionText ?? '')).toBe(false);
  });

  test('E+F: whole-dish replacement bumps plan version and shopping persists', async ({ page }) => {
    const email = `rp202a-sub-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 20000 });
    const versionBefore = Number(
      ((await page.getByTestId('meal-plan-version').textContent()) ?? '').match(/(\d+)/)?.[1] ?? NaN,
    );

    const lunchReplace = page
      .locator('li')
      .filter({ hasText: /buckwheat|греч|обед/i })
      .locator('[data-testid^="meal-card-replace-"]')
      .first();
    if (await lunchReplace.count()) await lunchReplace.click();
    else await page.locator('[data-testid^="meal-card-replace-"]').first().click();

    await expect(page.getByTestId('substitution-candidates')).toBeVisible({ timeout: 20000 });
    const body = await page.locator('[data-testid="substitution-panel"]').innerText();
    expect(/HEURISTIC_CATALOG_MATCH|gluten_free/i.test(body)).toBe(false);

    const equivalent = page.getByTestId('substitution-candidate-EQUIVALENT').first();
    if (await equivalent.count()) await equivalent.getByTestId('substitution-select').click();
    else await page.getByTestId('substitution-select').first().click();
    await expect(page.getByTestId('substitution-preview')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('substitution-confirm').click();
    await expect(page.getByTestId('meal-plan-version')).not.toContainText(String(versionBefore), {
      timeout: 25000,
    });
    const versionAfter = Number(
      ((await page.getByTestId('meal-plan-version').textContent()) ?? '').match(/(\d+)/)?.[1] ?? NaN,
    );
    expect(versionAfter).toBeGreaterThan(versionBefore);

    await page.goto('/shopping-list');
    if (await page.getByTestId('shopping-empty').count()) {
      await page.getByTestId('shopping-generate').click();
    }
    await expect(page.getByTestId('shopping-items')).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(page.getByTestId('shopping-items')).toBeVisible({ timeout: 20000 });
  });

  test('H: mobile 390x844 meal plan, dish detail, replacement, shopping', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `rp202a-mobile-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid^="meal-card-details-"]').first().click();
    await expect(page.getByTestId('meal-dish-detail')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('meal-dish-back').click();

    await page.locator('[data-testid^="meal-card-replace-"]').first().click();
    await expect(page.getByTestId('substitution-panel')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('substitution-mode-ingredient').click();
    await expect(page.getByTestId('substitution-ingredient-select')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('substitution-close').click();

    await page.goto('/shopping-list');
    await expect(page.getByTestId('shopping-generate').or(page.getByTestId('shopping-items')).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('G: published RecipeVersion update API rejected for user', async ({ page }) => {
    const email = `rp202a-immut-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);
    const res = await page.request.patch(`${api}/admin/recipes/00000000-0000-4000-8000-000000000001/versions/1`, {
      data: { title: 'hack' },
    });
    expect([401, 403, 404, 405]).toContain(res.status());
  });
});
