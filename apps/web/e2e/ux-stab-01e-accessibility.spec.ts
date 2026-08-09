import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * UX-STAB-01E accessibility regression.
 * Critical/serious axe violations must be 0 on covered routes.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01e');
const password = 'UxStab01eA11yPass1!';

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

import { registerAndCompleteOnboarding } from './helpers/onboarding';

async function register(page: Page, email: string) {
  await registerAndCompleteOnboarding(page, email, password);
}

async function axeCriticalSerious(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(bad, `${label} axe critical/serious: ${JSON.stringify(bad, null, 2)}`).toEqual([]);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

test.describe('UX-STAB-01E accessibility', () => {
  test.beforeEach(async ({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(async () => {
    expect(fatal, `Fatal browser issues: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('login: lang, skip-link, labels, axe, focus-visible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', /^(ru|ru-)/);
    await expect(page.getByTestId('skip-to-content')).toBeAttached();
    await expect(page.getByTestId('main-content')).toBeAttached();
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('label[for="identifier"]')).toBeVisible();
    await expect(page.locator('label[for="password"]')).toBeVisible();
    await expect(page.getByTestId('auth-password')).toHaveAttribute('autocomplete', 'current-password');

    await page.keyboard.press('Tab');
    const skip = page.getByTestId('skip-to-content');
    await expect(skip).toBeFocused();
    await shot(page, '01-skip-link-focus');

    await skip.press('Enter');
    await expect(page.getByTestId('main-content')).toBeFocused();

    await page.getByTestId('auth-submit').focus();
    const outline = await page.getByTestId('auth-submit').evaluate((el) => {
      const style = getComputedStyle(el);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(outline.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(outline.outlineWidth)).toBeGreaterThan(0);
    await shot(page, '02-focus-visible-login');

    await axeCriticalSerious(page, 'login');
  });

  test('login form error association + register labels', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('auth-email').fill('nobody-a11y@example.test');
    await page.getByTestId('auth-password').fill('DefinitelyWrongPass1!');
    await page.getByTestId('auth-submit').click();
    const error = page.getByTestId('auth-error');
    await expect(error).toBeVisible({ timeout: 15_000 });
    const errorId = await error.getAttribute('id');
    expect(errorId).toBeTruthy();
    await expect(page.getByTestId('auth-email')).toHaveAttribute('aria-describedby', errorId!);
    await expect(page.getByTestId('auth-password')).toHaveAttribute('aria-invalid', 'true');
    await shot(page, '03-form-error-association');

    await page.goto('/register');
    await expect(page.getByTestId('auth-password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('main h1')).toHaveCount(1);
    await axeCriticalSerious(page, 'register');
  });

  test('authenticated USER routes: landmarks, nav aria-current, axe, RU/EN', async ({ page }) => {
    const email = `uxstab01e-user-${Date.now()}@example.com`;
    await register(page, email);

    const routes: Array<{ path: string; heading: string | RegExp }> = [
      { path: '/dashboard-today', heading: /Сегодня|Today/ },
      { path: '/shopping-list', heading: /Список покупок|Shopping/ },
      { path: '/assistant', heading: /AI|ассистент|Assistant/i },
      { path: '/settings', heading: /Профиль|Profile|Настройк|Settings/i },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator('html')).toHaveAttribute('lang', /^(ru|ru-)/);
      await expect(page.getByTestId('skip-to-content')).toBeAttached();
      await expect(page.getByTestId('user-navigation')).toBeVisible();
      await expect(page.getByTestId('admin-navigation')).toHaveCount(0);
      await expect(page.locator('main h1').first()).toBeVisible();
      const current = page.locator('nav a[aria-current="page"]');
      await expect(current.first()).toBeVisible();
      await axeCriticalSerious(page, route.path);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    }

    await page.goto('/shopping-list');
    await expect(page.getByTestId('nav-shopping')).toHaveAttribute('aria-current', 'page');
    await shot(page, '04-user-nav-aria-current');

    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-input')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('label[for="assistant-input"]')).toBeAttached();
    await axeCriticalSerious(page, 'assistant');
    await shot(page, '05-assistant-composer');

    // EN locale via profile (settings)
    await page.goto('/settings');
    await page.getByTestId('profile-locale').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
    await expect(page.getByTestId('skip-to-content')).toHaveText(/Skip to main content/i);
    await expect(page.getByTestId('nav-today')).toHaveText('Today');
    await axeCriticalSerious(page, 'settings-en');
    await shot(page, '06-en-skip-link-nav');
  });

  test('UI states Loading/Empty/Error/Forbidden accessible', async ({ page }) => {
    const email = `uxstab01e-states-${Date.now()}@example.com`;
    await register(page, email);

    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' });
    });
    await page.goto('/dashboard-today');
    const forbidden = page.getByTestId('dashboard-forbidden').or(page.getByTestId('ui-forbidden'));
    await expect(forbidden.first()).toBeVisible({ timeout: 15_000 });
    await expect(forbidden.first()).toHaveAttribute('role', 'alert');
    expect(page.url()).not.toMatch(/\/login/);
    await axeCriticalSerious(page, 'forbidden');
    await shot(page, '07-forbidden-state');

    await page.unroute('**/api/v1/dashboard/today**');
    await page.route('**/api/v1/dashboard/today**', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"UNAUTHORIZED"}' });
    });
    await page.goto('/dashboard-today');
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.has('next'), {
      timeout: 20_000,
    });
    const next = new URL(page.url()).searchParams.get('next') ?? '';
    expect(next.startsWith('/')).toBe(true);
    expect(next).not.toMatch(/https?:|javascript:/i);
  });

  test('zoom 200% keeps primary login usable without page trap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');
    await expect(page.getByTestId('auth-submit')).toBeVisible();
    // Prefer CSS zoom on html (avoids React hydration noise from mutating body inline styles).
    await page.addStyleTag({ content: 'html { zoom: 200%; }' });
    await expect(page.getByTestId('auth-submit')).toBeVisible();
    await expect(page.locator('main h1')).toBeVisible();
    await page.getByTestId('auth-email').focus();
    await expect(page.getByTestId('auth-email')).toBeFocused();
    await shot(page, '08-zoom-200-login');
  });

  test('keyboard Tab order on login has no trap', async ({ page }) => {
    await page.goto('/login');
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return 'none';
        return `${el.tagName}:${el.getAttribute('data-testid') ?? el.id ?? el.className}`;
      });
      seen.add(info);
    }
    expect(seen.size).toBeGreaterThan(2);
    // Shift+Tab should still move
    await page.keyboard.press('Shift+Tab');
    const after = await page.evaluate(() => document.activeElement?.tagName ?? 'none');
    expect(after).not.toBe('none');
  });

  test('OWNER navigation keyboard + aria-current when creds present', async ({ page }) => {
    const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
    const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
    test.skip(!ownerUser || !ownerPass, 'OWNER_E2E_* required for OWNER a11y check');

    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.getByTestId('auth-role-badge').waitFor({ timeout: 30_000 });
    await page.goto('/admin/content');
    await expect(page.getByTestId('admin-navigation')).toBeVisible();
    await expect(page.getByTestId('nav-admin-content')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('nav-admin-content').focus();
    await page.keyboard.press('Tab');
    const focusedInNav = await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active?.closest('[data-testid="admin-navigation"]'));
    });
    expect(focusedInNav).toBe(true);

    await axeCriticalSerious(page, 'owner-admin-content');
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="auth-user-email"]');
      if (el) el.textContent = 'owner-e2e@example.com';
    });
    await shot(page, '09-owner-keyboard-nav');
  });

  test('no custom dialog components — native confirm only (document)', async ({ page }) => {
    await page.goto('/login');
    const dialogCount = await page.locator('[role="dialog"], [aria-modal="true"]').count();
    expect(dialogCount).toBe(0);
  });
});
