import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * UX-STAB-01D responsive regression.
 * Page-level horizontal overflow is forbidden; local table/nav scroll is allowed.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01d');
const password = 'UxStab01dReview1!';
const VIEWPORTS = [360, 390, 430, 768, 1024, 1280] as const;

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

async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

async function assertNoPageOverflow(page: Page, label: string) {
  const metrics = await pageOverflow(page);
  expect(
    metrics.scrollWidth - metrics.clientWidth,
    `${label} page overflow (scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(1);
}

import { registerAndCompleteOnboarding } from './helpers/onboarding';

async function register(page: Page, email: string) {
  await registerAndCompleteOnboarding(page, email, password);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

test.describe('UX-STAB-01D responsive', () => {
  test.beforeEach(async ({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(async () => {
    expect(fatal, `Fatal browser issues: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('390px shopping nav label is not truncated; page has no horizontal overflow', async ({ page }) => {
    const email = `uxstab01d-nav-${Date.now()}@example.com`;
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page, email);

    await page.goto('/shopping-list');
    await page.getByTestId('nav-shopping').waitFor();
    const shopping = page.getByTestId('nav-shopping');
    const label = (await shopping.innerText()).trim();
    expect(label).toBe('Список покупок');
    expect(label).not.toMatch(/…|\.\.\.|Покупк…/);

    const metrics = await shopping.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        textOverflow: style.textOverflow,
        fullyInViewport: rect.left >= 0 && rect.right <= window.innerWidth + 1,
      };
    });
    expect(metrics.textOverflow).not.toBe('ellipsis');
    expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
    expect(metrics.fullyInViewport).toBe(true);

    await assertNoPageOverflow(page, 'shopping@390');
    await shot(page, '01-shopping-nav-390');
  });

  test('core routes: no page overflow across 360–1280', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `uxstab01d-vp-${Date.now()}@example.com`;
    await register(page, email);

    const routes: Array<{ path: string; name: string }> = [
      { path: '/login', name: 'login' },
      { path: '/register', name: 'register' },
      { path: '/dashboard-today', name: 'dashboard' },
      { path: '/onboarding', name: 'profile' },
      { path: '/settings', name: 'settings' },
      { path: '/meal-plan', name: 'meal-plan' },
      { path: '/nutrition-engine', name: 'meal-tracking' },
      { path: '/workout-engine', name: 'workout' },
      { path: '/progress', name: 'progress' },
      { path: '/shopping-list', name: 'shopping' },
      { path: '/assistant', name: 'assistant' },
      { path: '/pantry', name: 'pantry' },
      { path: '/budget-mode', name: 'budget' },
      { path: '/price-intelligence', name: 'prices' },
      { path: '/pricing', name: 'pricing' },
      { path: '/payments', name: 'payments' },
    ];

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of routes) {
        fatal.length = 0;
        const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(response?.status() ?? 0, route.path).toBeLessThan(500);
        await page.waitForTimeout(150);
        await assertNoPageOverflow(page, `${route.name}@${width}`);
        const body = await page.locator('body').innerText();
        expect(body).not.toMatch(/MISSING_I18N/i);
      }
      await page.goto('/dashboard-today', { waitUntil: 'domcontentloaded' });
      await shot(page, `02-dashboard-vp-${width}`);
    }
  });

  test('RU/EN locale switch + reload keeps chrome coherent at 390', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `uxstab01d-locale-${Date.now()}@example.com`;
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page, email);

    await page.goto('/settings');
    await page.getByTestId('profile-form').waitFor({ timeout: 45_000 });
    await page.getByTestId('profile-name').fill('UX-STAB-01D');
    await page.getByTestId('profile-age').fill('30');
    await page.getByTestId('profile-height').fill('170');
    await page.getByTestId('profile-weight').fill('70');
    await page.getByTestId('profile-goal-target').fill('65');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохранён|Profile saved/i, {
      timeout: 60_000,
    });

    await page.getByTestId('profile-locale').selectOption('en');
    await expect(page.getByTestId('profile-save')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохранён|Profile saved/i, {
      timeout: 60_000,
    });
    await page.reload({ waitUntil: 'networkidle' });
    let body = await page.locator('body').innerText();
    expect(body).toMatch(/Settings|Meal Plan|Shopping List/i);
    expect(body).not.toMatch(/План питания|Список покупок|Настройки/);
    await assertNoPageOverflow(page, 'settings-en@390');

    await page.getByTestId('profile-locale').selectOption('ru');
    await expect(page.getByTestId('profile-save')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохранён|Profile saved/i, {
      timeout: 60_000,
    });
    await page.reload({ waitUntil: 'networkidle' });
    body = await page.locator('body').innerText();
    expect(body).toMatch(/Настройки|План питания|Список покупок/);
    expect(body).not.toMatch(/\bMeal Plan\b|\bShopping List\b|\bSettings\b/);
    await assertNoPageOverflow(page, 'settings-ru@390');
    await shot(page, '03-settings-ru-390');
  });

  test('401/403 states remain usable at 390 without page overflow', async ({ page }) => {
    const email = `uxstab01d-states-${Date.now()}@example.com`;
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page, email);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' });
    });
    await page.goto('/dashboard-today');
    await page.getByTestId('dashboard-forbidden').waitFor({ timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/login/);
    await assertNoPageOverflow(page, 'forbidden@390');
    await shot(page, '04-forbidden-390');

    await page.unroute('**/api/v1/dashboard/today**');
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"UNAUTHORIZED"}' });
    });
    await page.goto('/dashboard-today');
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.has('next'), {
      timeout: 20_000,
    });
    await assertNoPageOverflow(page, 'login-next@390');
    await shot(page, '05-login-next-390');
  });

  test('USER nav has no admin items at 390 without page overflow', async ({ page }) => {
    const email = `uxstab01d-user-nav-${Date.now()}@example.com`;
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page, email);
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('user-navigation')).toBeVisible();
    await expect(page.getByTestId('admin-navigation')).toHaveCount(0);
    await expect(page.getByTestId('nav-admin-content')).toHaveCount(0);
    await assertNoPageOverflow(page, 'user-nav@390');
    await shot(page, '06-user-nav-390');
  });

  test('OWNER admin nav scrolls locally without page overflow at 390', async ({ page }) => {
    const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
    const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
    test.skip(!ownerUser || !ownerPass, 'OWNER_E2E_* required for OWNER nav check');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.getByTestId('auth-role-badge').waitFor({ timeout: 30_000 });
    await page.goto('/admin/content');
    await expect(page.getByTestId('admin-navigation')).toBeVisible();
    const adminMetrics = await page.evaluate(() => {
      const ul = document.querySelector('[data-testid="admin-navigation"]');
      const doc = document.documentElement;
      return {
        pageOverflow: doc.scrollWidth - doc.clientWidth,
        localScrollPossible: ul ? ul.scrollWidth >= ul.clientWidth : false,
        wrap: ul ? getComputedStyle(ul).flexWrap : null,
      };
    });
    expect(adminMetrics.pageOverflow).toBeLessThanOrEqual(1);
    expect(adminMetrics.wrap).toBe('nowrap');
    await assertNoPageOverflow(page, 'owner-admin@390');
    // Evidence only: redact local OWNER fixture identity before synthetic screenshot.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="auth-user-email"]');
      if (el) el.textContent = 'owner-e2e@example.com';
    });
    await shot(page, '07-owner-admin-nav-390');
  });
});
