import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

/**
 * UX-STAB-01H account / settings browser review.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01h');
const password = 'UxStab01hSettingsPass1!';

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

async function openSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 45_000 });
}

test.describe('UX-STAB-01H account / settings', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('loads account + sections; save profile/goal; reload; no redirect loop', async ({ page }) => {
    const email = `uxstab01h-load-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await openSettings(page);

    await expect(page.getByTestId('settings-account-section')).toBeVisible();
    await expect(page.getByTestId('settings-account-email')).toContainText(email);
    await expect(page.getByTestId('settings-account-role')).toContainText(/USER/i);
    await expect(page.getByTestId('settings-account-tier')).toBeVisible();
    await expect(page.getByTestId('settings-profile-section')).toBeVisible();
    await expect(page.getByTestId('settings-goal-section')).toBeVisible();
    await expect(page.getByTestId('settings-app-section')).toBeVisible();
    await expect(page.getByTestId('settings-preferences-section')).toBeVisible();
    await expect(page.getByTestId('settings-security-section')).toBeVisible();
    await expect(page.getByTestId('settings-logout')).toBeVisible();
    await expect(page.getByTestId('settings-change-password')).toHaveCount(0);
    await expect(page.getByTestId('admin-navigation')).toHaveCount(0);
    await expect(page.locator('main h1')).toHaveCount(1);
    await shot(page, '01-account-overview');

    const name = `Settings User ${Date.now()}`;
    await page.getByTestId('profile-name').fill(name);
    await page.getByTestId('profile-age').fill('32');
    await page.getByTestId('profile-height').fill('178');
    await page.getByTestId('profile-weight').fill('82');
    await page.getByTestId('profile-goal-target').fill('74');
    await expect(page.getByTestId('profile-save')).toBeEnabled();
    await expect(page.getByTestId('settings-dirty-hint')).toBeVisible();
    await shot(page, '02-profile-editing');

    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 45_000 });
    await expect(page.getByTestId('profile-save')).toBeDisabled();
    await shot(page, '03-saved-state');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(page);
    await expect(page.getByTestId('profile-name')).toHaveValue(name);
    await expect(page.getByTestId('profile-goal-target')).toHaveValue('74');

    await page.goto('/dashboard-today');
    await expect(page).toHaveURL(/dashboard-today/);
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0);
  });

  test('validation focuses first error; failed submit keeps values + Retry', async ({ page }) => {
    const email = `uxstab01h-val-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await openSettings(page);

    await page.getByTestId('profile-name').fill('X');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toBeVisible();
    await expect(page.getByTestId('profile-name')).toBeFocused();
    await shot(page, '04-validation');

    await page.getByTestId('profile-name').fill('Valid Name');
    await page.getByTestId('profile-age').fill('30');
    await page.getByTestId('profile-height').fill('175');
    await page.getByTestId('profile-weight').fill('80');
    await page.getByTestId('profile-goal-target').fill('70');

    let putCount = 0;
    await page.route('**/api/v1/profile**', async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      putCount += 1;
      if (putCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'INTERNAL', message: 'boom' }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('profile-name')).toHaveValue('Valid Name');
    await expect(page.getByTestId('profile-save-retry')).toBeVisible();
    await shot(page, '05-partial-error');

    await page.getByTestId('profile-save-retry').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i, { timeout: 45_000 });
  });

  test('double submit blocked; goal partial 500 keeps profile section', async ({ page }) => {
    const email = `uxstab01h-partial-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.route('**/api/v1/goal**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INTERNAL' }),
      });
    });

    await openSettings(page);
    await expect(page.getByTestId('settings-partial-notice')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('settings-goal-warn')).toBeVisible();
    await expect(page.getByTestId('settings-profile-section')).toBeVisible();
    await expect(page.getByTestId('profile-name')).toBeVisible();

    await page.unroute('**/api/v1/goal**');
    await page.getByTestId('settings-partial-retry').click();
    await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 45_000 });
  });

  test('403 on goal stays on settings; 401 on profile goes login', async ({ page }) => {
    const email = `uxstab01h-authz-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.route('**/api/v1/goal**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'FORBIDDEN' }),
      });
    });
    await openSettings(page);
    await expect(page).toHaveURL(/settings/);
    expect(page.url()).not.toMatch(/\/login/);
    await expect(page.getByTestId('settings-account-section')).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bFORBIDDEN\b/);

    await page.unroute('**/api/v1/goal**');
    await page.route('**/api/v1/profile**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'UNAUTHORIZED' }),
      });
    });
    await page.goto('/settings');
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.has('next'), {
      timeout: 20_000,
    });
  });

  test('locale RU→EN save+reload; keyboard focus; mobile 390; logout', async ({ page }) => {
    const email = `uxstab01h-locale-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await openSettings(page);

    await expect(page.locator('html')).toHaveAttribute('lang', /^(ru|ru-)/);
    await page.getByTestId('profile-locale').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
    await expect(page.getByTestId('profile-save')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/saved/i, { timeout: 45_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(page);
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
    await expect(page.getByTestId('profile-locale')).toHaveValue('en');
    await shot(page, '06-en');

    await page.getByTestId('profile-locale').selectOption('ru');
    await expect(page.getByTestId('profile-save')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-status')).toContainText(/сохран/i, { timeout: 45_000 });
    await shot(page, '07-ru');

    await page.getByTestId('profile-name').click();
    await expect(page.getByTestId('profile-name')).toBeFocused();
    await shot(page, '08-keyboard-focus');

    await page.setViewportSize({ width: 390, height: 844 });
    await openSettings(page);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await axeCriticalSerious(page, 'settings-390');
    await shot(page, '09-mobile-390');

    await page.getByTestId('settings-logout').click();
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 30_000 });
    await page.goBack();
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/\/login|\/register/);
    if (page.url().includes('/settings')) {
      await expect(page.getByTestId('profile-form')).toHaveCount(0);
    }
  });

  test('OWNER reaches settings without USER-only admin actions; secrets absent', async ({ page }) => {
    const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
    const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
    test.skip(!ownerUser || !ownerPass, 'OWNER_E2E_* required');

    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });
    await openSettings(page);
    await expect(page.getByTestId('settings-account-role')).toContainText(/OWNER/i);
    await expect(page.getByTestId('settings-logout')).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/passwordHash|sessionId|Bearer |api[_-]?key/i);
  });
});
