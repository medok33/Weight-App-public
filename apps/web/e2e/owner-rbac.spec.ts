import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * OWNER E2E — credentials ONLY from env (never hardcoded).
 * Set OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD locally to run.
 */
const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const ownerUser = process.env.OWNER_E2E_USERNAME ?? '';
const ownerPass = process.env.OWNER_E2E_PASSWORD ?? '';
const hasOwnerCreds = Boolean(ownerUser && ownerPass);

test.describe('OWNER unified RBAC', () => {
  test.skip(!hasOwnerCreds, 'OWNER_E2E_USERNAME / OWNER_E2E_PASSWORD not set');

  test('login by username → me OWNER PREMIUM → reload keeps session', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    const cookies = await context.cookies('http://localhost:3001');
    const session = cookies.find((c) => c.name === 'wa_session_local' || c.name === 'wa_session');
    expect(session?.httpOnly).toBe(true);

    const me = await page.request.get(`${api}/auth/me`);
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.role).toBe('OWNER');
    expect(body.tier).toBe('PREMIUM');
    expect(JSON.stringify(body)).not.toMatch(/credentialHash|password/i);

    await expect(page.getByTestId('auth-role-badge')).toHaveText('OWNER');
    await page.reload();
    await expect(page.getByTestId('auth-role-badge')).toHaveText('OWNER');
    await page.screenshot({ path: resolve(screenshotsDir, '100-owner-dashboard.png'), fullPage: true });
  });

  test('OWNER navigation and admin surfaces', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });
    await expect(page.getByTestId('auth-role-badge')).toHaveText('OWNER', { timeout: 30000 });

    await expect(page.getByTestId('nav-admin-entry')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('nav-admin-entry').click();
    await expect(page.getByTestId('nav-admin-content')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('nav-prices')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: resolve(screenshotsDir, '101-owner-admin.png'), fullPage: true });

    await page.goto('/price-intelligence');
    await expect(page.getByTestId('nav-prices').or(page.getByRole('heading').first())).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: resolve(screenshotsDir, '102-owner-prices.png'), fullPage: true });

    await page.goto('/owner-admin');
    await expect(page.getByTestId('nav-users').or(page.getByRole('heading').first())).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: resolve(screenshotsDir, '103-owner-ai-metrics.png'), fullPage: true });
  });

  test('USER cannot call owner-admin; role body injection ignored', async ({ page, request }) => {
    const email = `iso-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Password12345');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    await expect(page.getByTestId('nav-owner')).toHaveCount(0);
    await expect(page.getByTestId('nav-prices')).toHaveCount(0);

    const forbidden = await page.request.get(`${api}/owner-admin/access`);
    expect([401, 403]).toContain(forbidden.status());

    const inject = await request.post(`${api}/auth/register`, {
      data: { email: `inject-${Date.now()}@test.com`, password: 'Password12345', role: 'OWNER' },
    });
    // register may set cookie for new user; response user role must not be OWNER
    if (inject.ok()) {
      const payload = await inject.json();
      expect(payload.user?.role).not.toBe('OWNER');
    }
  });
});
