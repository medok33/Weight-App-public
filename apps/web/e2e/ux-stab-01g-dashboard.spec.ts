import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

/**
 * UX-STAB-01G dashboard browser review.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01g');
const password = 'UxStab01gDashPass1!';

fs.mkdirSync(SHOT_DIR, { recursive: true });

const fatal: string[] = [];

function attachGuards(page: Page) {
  page.on('pageerror', (err) => fatal.push(`pageerror: ${err.message}`));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource: the server responded with a status of [45]\d\d/i.test(text)) return;
    if (/Download the React DevTools|\[HMR\]|Fast Refresh/i.test(text)) return;
    fatal.push(`console.error: ${text}`);
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function axeCriticalSerious(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(bad, `${label} axe: ${JSON.stringify(bad, null, 2)}`).toEqual([]);
}

const readyDashboardBody = {
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
};

const emptyDashboardBody = {
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
};

test.describe('UX-STAB-01G dashboard', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('after onboarding USER lands on dashboard with quick actions', async ({ page }) => {
    const email = `uxstab01g-onb-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await expect(page).toHaveURL(/dashboard-today/);
    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-quick-actions')).toBeVisible();
    await expect(page.getByTestId('admin-navigation')).toHaveCount(0);
    await shot(page, '01-after-onboarding');
  });

  test('populated dashboard: blocks, quick action, return', async ({ page }) => {
    const email = `uxstab01g-pop-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyDashboardBody),
      });
    });
    await page.route('**/api/v1/progress**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 'synthetic',
          latest: { userId: 'synthetic', weightKg: 80, measuredAt: '2026-07-30T10:00:00.000Z' },
          entries: [],
          deltaKg: -0.5,
        }),
      });
    });

    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-heading')).toBeVisible();
    await expect(page.getByTestId('dashboard-nutrition-metrics')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-meal-plan')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-workout')).toBeVisible();
    await expect(page.getByTestId('dashboard-budget-metrics')).toBeVisible();
    await expect(page.getByTestId('dashboard-progress-latest')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-nutrition')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-card-budget-today')).toHaveCount(0);
    await shot(page, '02-populated');

    await page.getByTestId('dashboard-qa-meal').click();
    await expect(page).toHaveURL(/meal-plan/);
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-quick-actions')).toBeVisible();
  });

  test('empty dashboard + progress block local error with retry', async ({ page }) => {
    const email = `uxstab01g-empty-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyDashboardBody),
      });
    });
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-empty')).toBeVisible();
    await expect(page.getByTestId('dashboard-empty-cta')).toBeVisible();
    await shot(page, '03-empty');

    await page.unroute('**/api/v1/dashboard/today**');
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyDashboardBody),
      });
    });

    let progressOk = false;
    await page.route('**/api/v1/progress**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      if (!progressOk) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 'synthetic', latest: null, entries: [], deltaKg: null }),
      });
    });

    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-heading')).toBeVisible();
    await expect(page.getByTestId('dashboard-nutrition-metrics')).toBeVisible();
    await expect(page.getByTestId('dashboard-progress-error')).toBeVisible();
    // Goal block must remain usable while progress fails (independent Retry).
    await expect(page.getByTestId('dashboard-goal-block')).toBeVisible();
    await expect(page.getByTestId('dashboard-goal-error')).toHaveCount(0);
    await shot(page, '04-partial-progress-error');
    progressOk = true;
    await page.getByTestId('dashboard-progress-retry').click();
    await expect(page.getByTestId('dashboard-progress-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-goal-error')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-nutrition-metrics')).toBeVisible();
  });

  test('goal 500 stays local; Retry does not reset progress', async ({ page }) => {
    const email = `uxstab01g-goal-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyDashboardBody),
      });
    });
    await page.route('**/api/v1/progress**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 'synthetic',
          latest: { userId: 'synthetic', weightKg: 80, measuredAt: '2026-07-30T10:00:00.000Z' },
          entries: [],
          deltaKg: -0.5,
        }),
      });
    });
    let goalOk = false;
    await page.route('**/api/v1/goal**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      if (!goalOk) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 'synthetic', kind: 'lose_weight', target: 72, unit: 'kg' }),
      });
    });

    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-goal-error')).toBeVisible();
    await expect(page.getByTestId('dashboard-progress-latest')).toBeVisible();
    goalOk = true;
    await page.getByTestId('dashboard-goal-retry').click();
    await expect(page.getByTestId('dashboard-goal-value')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-progress-latest')).toBeVisible();
  });

  test('403 on progress stays on page; 401 on dashboard goes to login', async ({ page }) => {
    const email = `uxstab01g-auth-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyDashboardBody),
      });
    });
    await page.route('**/api/v1/progress**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' });
    });
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-nutrition-metrics')).toBeVisible();
    await expect(page.getByTestId('dashboard-progress-error')).toBeVisible();
    expect(page.url()).toContain('/dashboard-today');

    await page.unroute('**/api/v1/dashboard/today**');
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"UNAUTHORIZED"}' });
    });
    await page.goto('/dashboard-today');
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.has('next'), {
      timeout: 20_000,
    });
  });

  test('RU/EN and 390px overflow + axe', async ({ page }) => {
    const email = `uxstab01g-a11y-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyDashboardBody),
      });
    });
    await page.goto('/dashboard-today');
    await expect(page.locator('html')).toHaveAttribute('lang', /^(ru|ru-)/);
    await expect(page.getByTestId('dashboard-qa-meal')).toHaveText(/План питания/);
    await axeCriticalSerious(page, 'dashboard-ru');
    await shot(page, '05-ru');

    await page.goto('/settings');
    await page.getByTestId('profile-form').waitFor({ timeout: 30_000 });
    const persist = page.waitForResponse(
      (r) =>
        /\/api\/v1\/profile(?:\?|$)/.test(r.url()) &&
        r.request().method() === 'PUT' &&
        r.ok(),
      { timeout: 20_000 },
    );
    await page.getByTestId('profile-locale').selectOption('en');
    await page.getByTestId('profile-save').click();
    await persist;
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-qa-meal')).toHaveText(/Meal plan/i);
    await shot(page, '06-en');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard-today');
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await page.getByTestId('dashboard-qa-shopping').focus();
    await expect(page.getByTestId('dashboard-qa-shopping')).toBeFocused();
    await shot(page, '07-mobile-390');
  });

  test('OWNER bypass still reaches dashboard without USER admin actions', async ({ page }) => {
    const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
    const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
    test.skip(!ownerUser || !ownerPass, 'OWNER_E2E_* required');

    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-heading').or(page.getByTestId('dashboard-loading'))).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('dashboard-qa-meal').or(page.getByTestId('dashboard-empty'))).toBeVisible({
      timeout: 30_000,
    });
  });
});
