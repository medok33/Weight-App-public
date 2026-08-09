import { expect, test, type Page, type ConsoleMessage } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * UX-STAB-01C browser review — locale hygiene, states, viewports, screenshots.
 * Does not fix mobile nav truncation («Покупк…») — that is UX-STAB-01D.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01c');
const password = 'UxStab01cReview1!';

fs.mkdirSync(SHOT_DIR, { recursive: true });

const fatal: string[] = [];
const noise: string[] = [];

const RU_MARKERS = [/План питания/, /Список покупок/, /AI-ассистент/, /Настройки/, /Сегодня/];
const EN_MARKERS = [/Meal plan|Meal Plan/, /Shopping list|Shopping List/, /AI assistant|Assistant/, /Settings/, /Today/];

function attachGuards(page: Page) {
  page.on('pageerror', (err) => fatal.push(`pageerror: ${err.message}`));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource: the server responded with a status of [45]\d\d/i.test(text)) {
      noise.push(text);
      return;
    }
    if (/Download the React DevTools|\[HMR\]|Fast Refresh/i.test(text)) return;
    fatal.push(`console.error: ${text}`);
  });
}

async function assertNoOverlay(page: Page) {
  const overlay = page.locator('#__next-build-error, nextjs-portal, [data-nextjs-dialog]');
  if (await overlay.count()) {
    const visible = await overlay.first().isVisible().catch(() => false);
    expect(visible, 'Next overlay visible').toBe(false);
  }
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/MISSING_I18N/i);
  expect(body).not.toMatch(/Application error: a client-side exception/i);
  expect(body).not.toMatch(/\bUNAUTHORIZED\b|\bFORBIDDEN\b|\bINTERNAL_SERVER_ERROR\b/);
}

import { registerAndCompleteOnboarding } from './helpers/onboarding';

async function register(page: Page, email: string) {
  await registerAndCompleteOnboarding(page, email, password);
}

async function fillMinimalProfile(page: Page) {
  await page.goto('/settings');
  await page.getByTestId('profile-form').waitFor({ timeout: 45_000 });
  await page.getByTestId('profile-name').fill('UX-STAB-01C Review');
  await page.getByTestId('profile-age').fill('32');
  await page.getByTestId('profile-height').fill('175');
  await page.getByTestId('profile-weight').fill('80');
  await page.getByTestId('profile-goal-target').fill('75');
  await page.getByTestId('profile-save').click();
  await page.getByTestId('profile-status').waitFor({ timeout: 45_000 }).catch(() => undefined);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

async function assertLocaleMarkers(page: Page, locale: 'ru' | 'en') {
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/MISSING_I18N/i);
  if (locale === 'ru') {
    for (const re of RU_MARKERS) expect(body).toMatch(re);
    // No mixed EN chrome labels in primary nav when RU is active
    expect(body).not.toMatch(/\bMeal plan\b|\bShopping list\b|\bSettings\b/);
  } else {
    for (const re of EN_MARKERS) expect(body).toMatch(re);
    expect(body).not.toMatch(/План питания|Список покупок|Настройки/);
  }
}

test.describe('UX-STAB-01C browser review', () => {
  test.beforeEach(async ({ page }) => {
    fatal.length = 0;
    noise.length = 0;
    attachGuards(page);
  });

  test.afterEach(async () => {
    expect(fatal, `Fatal browser issues: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('RU default, EN/RU persistence, unknown product fallback, 401/403', async ({ page }) => {
    const email = `uxstab01c-${Date.now()}@example.com`;
    await register(page, email);
    await fillMinimalProfile(page);

    // RU is default after register
    await page.goto('/dashboard-today');
    await assertNoOverlay(page);
    await assertLocaleMarkers(page, 'ru');
    await shot(page, '01-dashboard-ru-1280');

    // Switch RU → EN, save, then reload (locale persists via profile PUT)
    await page.goto('/settings');
    await page.getByTestId('profile-form').waitFor({ timeout: 45_000 });
    await page.getByTestId('profile-locale').selectOption('en');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toBeVisible({ timeout: 45_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await assertLocaleMarkers(page, 'en');
    await shot(page, '02-settings-en-after-reload');

    // Switch EN → RU, save, then reload
    await page.getByTestId('profile-locale').selectOption('ru');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toBeVisible({ timeout: 45_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await assertLocaleMarkers(page, 'ru');
    await shot(page, '03-settings-ru-after-reload');

    // 403 ForbiddenState without logout
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' });
    });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-forbidden').waitFor({ timeout: 15_000 });
    expect(page.url()).toContain('/dashboard-today');
    expect(page.url()).not.toMatch(/\/login/);
    const forbiddenText = await page.getByTestId('dashboard-forbidden').innerText();
    expect(forbiddenText).not.toMatch(/\bFORBIDDEN\b/);
    await shot(page, '04-dashboard-forbidden-ru');

    // 401 preserves login?next=
    await page.unroute('**/api/v1/dashboard/today**');
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"code":"UNAUTHORIZED"}',
      });
    });
    await page.goto('/dashboard-today');
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.has('next'), {
      timeout: 20_000,
    });
    expect(page.url()).toMatch(/next=%2Fdashboard-today|next=\/dashboard-today/);
    const loginBody = await page.locator('body').innerText();
    expect(loginBody).not.toMatch(/\bUNAUTHORIZED\b/);
    await shot(page, '05-login-next-preserved');
  });

  test('core routes + viewports 390/768/1280 without RU/EN mix', async ({ page }) => {
    const email = `uxstab01c-vp-${Date.now()}@example.com`;
    await register(page, email);
    await fillMinimalProfile(page);

    const routes: Array<{ path: string; name: string }> = [
      { path: '/login', name: 'login' },
      { path: '/register', name: 'register' },
      { path: '/dashboard-today', name: 'dashboard' },
      { path: '/settings', name: 'settings' },
      { path: '/meal-plan', name: 'meal-plan' },
      { path: '/workout-engine', name: 'workout' },
      { path: '/progress', name: 'progress' },
      { path: '/shopping-list', name: 'shopping' },
      { path: '/assistant', name: 'assistant' },
      { path: '/price-intelligence', name: 'price-intelligence' },
      { path: '/pricing', name: 'pricing' },
      { path: '/payments', name: 'payments' },
    ];

    for (const width of [390, 768, 1280] as const) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of routes) {
        fatal.length = 0;
        const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(response?.status() ?? 0).toBeLessThan(500);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await assertNoOverlay(page);
        const body = await page.locator('body').innerText();
        expect(body).not.toMatch(/MISSING_I18N/i);
        // RU default — no EN chrome mix on primary labels
        if (!['/login', '/register'].includes(route.path) || body.includes('Сегодня') || body.includes('Weight App')) {
          expect(body).not.toMatch(/\bMeal plan\b|\bShopping list\b/);
        }
      }
      await page.goto('/dashboard-today');
      await shot(page, `06-dashboard-vp-${width}`);
      await page.goto('/shopping-list');
      await shot(page, `07-shopping-vp-${width}`);
      // Observe truncation only — do not fail/fix (01D)
    }

    // Loading / Empty / Error / Forbidden / Retry evidence (mocked)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: '2026-07-31',
          nutrition: {
            plannedKcal: 0,
            consumedKcal: 0,
            remainingKcal: 0,
            proteinConsumed: 0,
            proteinTarget: 0,
            completedMealIds: [],
          },
          budget: { todayCost: 0, weekCost: 0, currency: 'RUB' },
          cards: [
            { id: 'meal-plan', title: 'card.mealPlan', status: 'empty', value: 'not_planned' },
            { id: 'workout', title: 'card.workout', status: 'empty', value: 'not_planned' },
            { id: 'nutrition', title: 'card.nutrition', status: 'empty', value: 'nutrition_summary' },
            { id: 'budget-today', title: 'card.budgetToday', status: 'empty', value: '0' },
            { id: 'budget-week', title: 'card.budgetWeek', status: 'empty', value: '0' },
          ],
        }),
      });
    });
    const loadPromise = page.goto('/dashboard-today');
    await page.getByTestId('dashboard-loading').waitFor({ timeout: 5000 }).catch(() => undefined);
    await shot(page, '08-loading-state');
    await loadPromise;
    await page.getByTestId('dashboard-empty').waitFor({ timeout: 15_000 });
    await shot(page, '09-empty-state');

    await page.unroute('**/api/v1/dashboard/today**');
    let allowSuccess = false;
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      if (!allowSuccess) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"message":"SELECT * FROM boom","code":"INTERNAL_SERVER_ERROR"}',
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: '2026-07-31',
          nutrition: {
            plannedKcal: 1800,
            consumedKcal: 400,
            remainingKcal: 1400,
            proteinConsumed: 30,
            proteinTarget: 120,
            completedMealIds: [],
          },
          budget: { todayCost: 10, weekCost: 70, currency: 'RUB' },
          cards: [
            { id: 'meal-plan', title: 'card.mealPlan', status: 'ready', value: 'greek_yogurt' },
            { id: 'workout', title: 'card.workout', status: 'ready', value: 'walk' },
            { id: 'nutrition', title: 'card.nutrition', status: 'ready', value: 'nutrition_summary' },
            { id: 'budget-today', title: 'card.budgetToday', status: 'ready', value: '10' },
            { id: 'budget-week', title: 'card.budgetWeek', status: 'ready', value: '70' },
          ],
        }),
      });
    });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-error').waitFor({ timeout: 15_000 });
    const errText = await page.getByTestId('dashboard-error').innerText();
    expect(errText).not.toMatch(/SELECT|INTERNAL_SERVER_ERROR|127\.0\.0\.1/i);
    await shot(page, '10-error-retry-state');
    allowSuccess = true;
    await page.getByTestId('dashboard-retry').click();
    await page.getByTestId('dashboard-heading').waitFor({ timeout: 15_000 });
  });
});
