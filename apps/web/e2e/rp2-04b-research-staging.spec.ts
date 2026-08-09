import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
const hasOwner = Boolean(ownerUser && ownerPass);

async function ownerLogin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('auth-email').fill(ownerUser);
  await page.getByTestId('auth-password').fill(ownerPass);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
  await expect(page.getByTestId('auth-role-badge')).toContainText('OWNER', { timeout: 30_000 });
}

test.describe('RP2-04B research staging browser acceptance', () => {
  test.skip(!hasOwner, 'OWNER_E2E_* required');

  test('A/C/D/I: OWNER manual staging + normalize without Recipe growth', async ({ page }) => {
    await ownerLogin(page);

    const beforeRecipes = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
    expect(beforeRecipes.ok()).toBeTruthy();
    const beforeTotal = Number(((await beforeRecipes.json()) as { total?: number }).total ?? 0);

    await page.goto('/admin/recipe-research');
    await expect(page.getByTestId('admin-recipe-research')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading').first()).toContainText(/Исследован/i);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\badmin\.recipeResearch\b/);

    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.getByTestId('admin-recipe-research')).toBeVisible();
    }

    await page.getByRole('button', { name: 'Создать' }).click();
    await expect(page.getByTestId('recipe-research-message')).toContainText(/Manual request|сохранён/i, {
      timeout: 20_000,
    });

    await page.getByRole('button', { name: 'Сохранить manual snapshot' }).click();
    await expect(page.getByTestId('recipe-research-message')).toContainText(/snapshot|сохранен/i, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('recipe-research-candidates').locator('li').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId('recipe-research-candidates').locator('button').first().click();
    await expect(page.getByTestId('recipe-research-candidate-detail')).toBeVisible();
    await page.getByRole('button', { name: 'Нормализовать' }).click();
    await expect(page.getByTestId('recipe-research-message')).toContainText(/нормализован/i, {
      timeout: 20_000,
    });

    const afterRecipes = await page.request.get(`${api}/admin/recipes?dataClass=PRODUCTION&pageSize=1`);
    const afterTotal = Number(((await afterRecipes.json()) as { total?: number }).total ?? 0);
    expect(afterTotal).toBe(beforeTotal);
  });

  test('H: USER / unauthenticated forbidden on research admin', async ({ page, browser }) => {
    await ownerLogin(page);

    const unauthCtx = await browser.newContext();
    const userPage = await unauthCtx.newPage();
    const status = (await userPage.request.get(`${api}/admin/recipe-research`)).status();
    expect([401, 403]).toContain(status);

    await userPage.goto('/admin/recipe-research');
    await expect(
      userPage
        .getByTestId('admin-recipe-research-forbidden')
        .or(userPage.getByTestId('auth-submit'))
        .or(userPage.getByText(/Нужны права|войти|Войти/i)),
    ).toBeVisible({ timeout: 30_000 });
    await unauthCtx.close();
  });
});
