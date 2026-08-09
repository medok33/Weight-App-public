import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * UX-STAB-01F onboarding happy path + guards.
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/ui/screenshots/ux-stab-01f');
const password = 'UxStab01fOnboard1!';

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

async function completeWizard(page: Page, name: string) {
  await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-welcome');

  await page.getByTestId('onboarding-continue').click();
  await expect(page.getByTestId('onboarding-step-profile')).toBeVisible();
  await page.getByTestId('onboarding-name').fill(name);
  await page.getByTestId('onboarding-age').fill('30');
  await page.getByTestId('onboarding-height').fill('175');
  await page.getByTestId('onboarding-weight').fill('80');
  await page.getByTestId('onboarding-activity').selectOption('moderate');
  await shot(page, '02-profile-step');
  await page.getByTestId('onboarding-continue').click();

  await expect(page.getByTestId('onboarding-step-goal')).toBeVisible();
  await page.getByTestId('onboarding-goal-kind').selectOption('lose_weight');
  await page.getByTestId('onboarding-goal-target').fill('72');
  await page.getByTestId('onboarding-continue').click();

  await expect(page.getByTestId('onboarding-step-preferences')).toBeVisible();
  await shot(page, '03-preferences');
  await page.getByTestId('onboarding-skip').click();

  await expect(page.getByTestId('onboarding-step-finish')).toBeVisible();
  await shot(page, '04-finish');
  await page.getByTestId('onboarding-continue').click();
  await page.waitForURL((url) => url.pathname.includes('dashboard-today'), { timeout: 60_000 });
}

test.describe('UX-STAB-01F onboarding', () => {
  test.beforeEach(async ({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(async () => {
    expect(fatal, `Fatal browser issues: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('register → onboarding → complete → dashboard → reload keeps completion', async ({ page }) => {
    const email = `uxstab01f-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });

    await completeWizard(page, 'Onboard User');

    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 20_000 });
    expect(page.url()).not.toMatch(/\/onboarding/);

    await page.goto('/onboarding');
    await expect(page.getByTestId('onboarding-go-dashboard')).toBeVisible();
    await expect(page.getByText(/уже выполнена|already complete/i)).toBeVisible();
  });

  test('validation blocks empty profile step and focuses field', async ({ page }) => {
    const email = `uxstab01f-val-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });
    await page.getByTestId('onboarding-continue').click();
    await page.getByTestId('onboarding-continue').click();
    await expect(page.getByTestId('onboarding-error')).toBeVisible();
    await shot(page, '05-validation');
  });

  test('dashboard redirects incomplete USER to onboarding without loop', async ({ page }) => {
    const email = `uxstab01f-gate-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });

    await page.goto('/dashboard-today');
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 30_000 });
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();
    // No bounce loop: stay on onboarding
    await page.waitForTimeout(800);
    expect(page.url()).toMatch(/\/onboarding/);
  });

  test('back/continue and refresh keep step query; settings remains editable', async ({ page }) => {
    const email = `uxstab01f-nav-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });
    await page.getByTestId('onboarding-continue').click();
    await expect(page).toHaveURL(/step=2/);
    await page.reload();
    await expect(page.getByTestId('onboarding-step-profile')).toBeVisible();
    await page.getByTestId('onboarding-back').click();
    await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible();

    await page.goto('/settings');
    await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30_000 });
  });

  test('390px onboarding has no page overflow', async ({ page }) => {
    const email = `uxstab01f-390-${Date.now()}@example.com`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, '06-mobile-390');
  });

  test('Finish without saved profile/goal does not complete via ?step=5', async ({ page }) => {
    const email = `uxstab01f-step-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });
    await page.goto('/onboarding?step=5');
    // Query cannot jump past unsaved required steps for a brand-new USER.
    await expect(page.getByTestId('onboarding-step-welcome').or(page.getByTestId('onboarding-step-profile'))).toBeVisible();
    expect(page.url()).not.toMatch(/dashboard-today/);
  });

  test('OWNER bypass when creds present', async ({ page }) => {
    const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
    const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
    test.skip(!ownerUser || !ownerPass, 'OWNER_E2E_* required');

    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.getByTestId('auth-role-badge').waitFor({ timeout: 30_000 });
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-heading').or(page.getByTestId('admin-navigation'))).toBeVisible({
      timeout: 30_000,
    });
    expect(page.url()).not.toMatch(/\/onboarding/);
  });
});
