import { expect, test, type Page, type ConsoleMessage } from '@playwright/test';
import path from 'node:path';

/**
 * UX-STAB-01B browser review — PR #8 scenarios + screenshots.
 * HTTP 200 alone is not success.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01b');
const password = 'UxStab01bReview1!';

const fatal: string[] = [];
const noise: string[] = [];

function attachGuards(page: Page) {
  page.on('pageerror', (err) => fatal.push(`pageerror: ${err.message}`));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Intentional 4xx/5xx mocks for error-state review — Chromium always logs these.
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
  expect(body).not.toMatch(/SELECT\s+\*|stack trace|127\.0\.0\.1:3001/i);
}

import { registerAndCompleteOnboarding } from './helpers/onboarding';

async function register(page: Page, email: string) {
  await registerAndCompleteOnboarding(page, email, password);
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

const emptyDashboardBody = {
  date: '2026-07-30',
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

const readyDashboardBody = {
  date: '2026-07-30',
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

test.describe('UX-STAB-01B browser review', () => {
  test.beforeEach(async ({ page }) => {
    fatal.length = 0;
    noise.length = 0;
    attachGuards(page);
  });

  test.afterEach(async () => {
    expect(fatal, `Fatal browser issues: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('safeReturnTo rejects dangerous next values in AuthScreen', async ({ page }) => {
    const dangerous = [
      'https://example.com',
      '//example.com',
      encodeURIComponent('https://example.com'),
      encodeURIComponent('//example.com'),
      '/\\example.com',
      'javascript:alert(1)',
    ];
    for (const next of dangerous) {
      await page.goto(`/login?next=${next}`);
      await expect(page.getByTestId('auth-login')).toBeVisible();
      await expect(page).toHaveURL(/\/login\/?$/);
      expect(page.url()).not.toMatch(/example\.com|javascript:/i);
    }

    const email = `uxstab-next-${Date.now()}@example.com`;
    await page.goto(`/register?next=${encodeURIComponent('https://evil.example')}`);
    await expect(page).toHaveURL(/\/register\/?$/);
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('dashboard-today'), { timeout: 60_000 });
    expect(page.url()).toContain('/dashboard-today');
    expect(page.url()).not.toContain('evil');
  });

  test('login?next=/dashboard-today returns after auth; RequireAuth no loop', async ({ page }) => {
    const email = `uxstab-auth-${Date.now()}@example.com`;
    await page.goto('/register?next=/dashboard-today');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('dashboard-today'), { timeout: 60_000 });
    await assertNoOverlay(page);

    // Visit login while authenticated → bounce to next without login↔login loop
    await page.goto('/login?next=/settings');
    await page.waitForURL((url) => url.pathname === '/settings', { timeout: 30_000 });
    expect(page.url()).toContain('/settings');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('dashboard states: loading, empty, error+retry, forbidden, 401', async ({ page }) => {
    const email = `uxstab-dash-${Date.now()}@example.com`;
    await register(page, email);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyDashboardBody),
      });
    });

    const loadPromise = page.goto('/dashboard-today');
    await page.getByTestId('dashboard-loading').waitFor({ timeout: 5000 }).catch(() => undefined);
    await shot(page, '01-dashboard-loading');
    await loadPromise;
    await page.getByTestId('dashboard-empty').waitFor({ timeout: 15_000 });
    await shot(page, '02-dashboard-empty');
    await assertNoOverlay(page);

    // Keep failing until Retry is clicked — absorbs React Strict Mode double-fetch.
    await page.unroute('**/api/v1/dashboard/today**');
    let allowSuccess = false;
    let retrySeen = false;
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      if (!allowSuccess) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"message":"SELECT * FROM boom at http://127.0.0.1:3001"}',
        });
        return;
      }
      retrySeen = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyDashboardBody),
      });
    });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-error').waitFor({ timeout: 15_000 });
    const errText = await page.getByTestId('dashboard-error').innerText();
    expect(errText).not.toMatch(/SELECT|127\.0\.0\.1|stack/i);
    await expect(page.getByTestId('dashboard-error')).toHaveAttribute('role', 'alert');
    await shot(page, '03-dashboard-error-retry');
    await page.getByTestId('dashboard-retry').focus();
    await expect(page.getByTestId('dashboard-retry')).toBeFocused();
    allowSuccess = true;
    await page.getByTestId('dashboard-retry').click();
    await page.getByTestId('dashboard-heading').waitFor({ timeout: 15_000 });
    expect(retrySeen).toBe(true);
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);

    await page.unroute('**/api/v1/dashboard/today**');
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' });
    });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-forbidden').waitFor({ timeout: 15_000 });
    expect(page.url()).toContain('/dashboard-today');
    expect(page.url()).not.toMatch(/\/login/);
    await shot(page, '04-dashboard-forbidden');

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
  });

  test('profile load/save/validation/side-error and persistence', async ({ page }) => {
    const email = `uxstab-prof-${Date.now()}@example.com`;
    await register(page, email);

    await page.goto('/settings');
    await page.getByTestId('profile-form').waitFor({ timeout: 30_000 });
    await assertNoOverlay(page);

    await page.getByTestId('profile-name').fill('Review User');
    await page.getByTestId('profile-age').fill('32');
    await page.getByTestId('profile-height').fill('175');
    await page.getByTestId('profile-weight').fill('80');
    await page.getByTestId('profile-goal-target').fill('75');

    await page.route('**/api/v1/meal-plan/regenerate**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    });

    await page.getByTestId('profile-save').click();
    await page.getByTestId('profile-status').waitFor({ timeout: 45_000 });
    const statusText = await page.getByTestId('profile-status').innerText();
    expect(statusText.length).toBeGreaterThan(0);
    const side = page.getByTestId('profile-side-error');
    if (await side.isVisible().catch(() => false)) {
      await shot(page, '06-profile-side-meal-error');
      const sideText = await side.innerText();
      expect(sideText).not.toMatch(/SELECT|stack|127\.0\.0\.1/i);
    } else {
      await shot(page, '06-profile-save-status');
    }

    await page.unroute('**/api/v1/meal-plan/regenerate**');
    await page.route('**/api/v1/meal-plan/regenerate**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.getByTestId('profile-name').fill('Review User Saved');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 45_000 });
    await shot(page, '05-profile-save-success');

    await page.reload();
    await page.getByTestId('profile-form').waitFor({ timeout: 30_000 });
    await expect(page.getByTestId('profile-name')).toHaveValue(/Review User/);
  });

  test('viewports 390/768/desktop — no horizontal clip on UI states', async ({ page }) => {
    const email = `uxstab-vp-${Date.now()}@example.com`;
    await register(page, email);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"message":"fail"}',
      });
    });

    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/dashboard-today');
      await page.getByTestId('dashboard-error').waitFor({ timeout: 15_000 });
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          retryVisible: !!document.querySelector('[data-testid="dashboard-retry"]'),
        };
      });
      expect(overflow.retryVisible).toBe(true);
      expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(8);
      await shot(page, `07-dashboard-error-vp-${width}`);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-retry').waitFor();
    for (let i = 0; i < 40; i++) {
      const focused = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid'),
      );
      if (focused === 'dashboard-retry') break;
      await page.keyboard.press('Tab');
    }
    const focused = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid'),
    );
    expect(focused).toBe('dashboard-retry');
  });

  test('partial data is not replaced by empty heuristic', async ({ page }) => {
    const email = `uxstab-partial-${Date.now()}@example.com`;
    await register(page, email);
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: '2026-07-30',
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
            { id: 'meal-plan', title: 'card.mealPlan', status: 'error', value: 'not_planned' },
            { id: 'workout', title: 'card.workout', status: 'empty', value: 'not_planned' },
            { id: 'nutrition', title: 'card.nutrition', status: 'empty', value: 'nutrition_summary' },
            { id: 'budget-today', title: 'card.budgetToday', status: 'empty', value: '0' },
            { id: 'budget-week', title: 'card.budgetWeek', status: 'empty', value: '0' },
          ],
        }),
      });
    });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-partial-notice').waitFor({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-empty')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
    await shot(page, '08-dashboard-partial-not-empty');
  });
});
