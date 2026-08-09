import { expect, test, type Page } from '@playwright/test';

const FORBIDDEN_UI = [
  'Production Recipes',
  'Price Intelligence',
  'Sync mock API',
  'Something went wrong',
  'Loading…',
  'Media review',
  'Coverage EMPTY',
  'TEST_ONLY recipes',
];

const RAW_ENUM_LEAK = /\b(PUBLISHED|NEEDS_REVALIDATION|OWNED_UPLOAD|ACTIVE_LICENSED|UNDERFILLED)\b/;
const KEY_LEAK = /\badmin\.[a-z0-9_.]+\b|\bnav\.[a-z]+\b/;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

async function visibleText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

async function assertRussianChrome(page: Page, opts?: { allowTechnicalOpen?: boolean }) {
  const text = await visibleText(page);
  for (const lit of FORBIDDEN_UI) {
    expect(text, `forbidden literal: ${lit}`).not.toContain(lit);
  }
  expect(text, 'translation key leak').not.toMatch(KEY_LEAK);
  if (!opts?.allowTechnicalOpen) {
    expect(text, 'raw enum leak in main UI').not.toMatch(RAW_ENUM_LEAK);
  }
}

test.describe('UI-RU-01 locale foundation', () => {
  test('Scenario A — USER desktop Russian chrome', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('nav-login')).toHaveText('Вход');
    await expect(page.getByTestId('nav-register')).toHaveText('Регистрация');

    await page.goto('/settings');
    await expect(page.getByTestId('nav-today')).toHaveText('Сегодня');
    await expect(page.getByTestId('nav-nutrition')).toHaveText('Питание');
    await expect(page.getByTestId('nav-workouts')).toHaveText('Тренировки');
    await expect(page.getByTestId('nav-shopping')).toHaveText('Покупки');
    await expect(page.getByTestId('nav-pantry')).toHaveText('Мои продукты');
    await expect(page.getByTestId('nav-budget-mode')).toHaveText('Бюджет');
    await expect(page.getByTestId('nav-progress')).toHaveText('Прогресс');
    await expect(page.getByTestId('nav-assistant')).toHaveText('Помощник');
    await expect(page.getByTestId('app-brand')).toHaveText('Weight App');

    for (const path of ['/dashboard-today', '/meal-plan', '/shopping-list', '/budget-mode', '/pantry', '/progress', '/assistant']) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      await assertRussianChrome(page);
    }
  });

  test('Scenario B — USER mobile 390×844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/onboarding', '/meal-plan', '/shopping-list', '/budget-mode', '/pantry']) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('nav-today')).toHaveText('Сегодня');
      await assertRussianChrome(page);
    }
  });

  test('Scenario C/D — ADMIN routes require auth gate in Russian', async ({ page }) => {
    for (const path of [
      '/admin/content',
      '/admin/recipes',
      '/admin/recipe-coverage',
      '/admin/recipe-revalidation',
      '/admin/recipe-duplicates',
      '/admin/media',
      '/admin/products',
      '/admin/recipe-sources',
      '/price-intelligence',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      const text = await visibleText(page);
      expect(text).not.toContain('Production Recipes');
      expect(text).not.toContain('Price Intelligence');
      expect(text).not.toMatch(KEY_LEAK);
    }
  });

  test('Scenario E — anonymous forbidden/error chrome stays Russian', async ({ page }) => {
    await page.goto('/owner-admin');
    await page.waitForLoadState('domcontentloaded');
    const text = await visibleText(page);
    expect(text).not.toContain('Something went wrong');
    expect(text).not.toContain('Owner MFA is required');
  });

  test('Scenario F — technical section label Russian when present', async ({ page }) => {
    await page.goto('/admin/media');
    await page.waitForLoadState('domcontentloaded');
    const details = page.locator('details summary');
    if ((await details.count()) > 0) {
      await expect(details.first()).toHaveText(/Технические сведения/);
      const before = await visibleText(page);
      expect(before).not.toMatch(UUID_RE);
    }
  });
});
