import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const password = 'Password12345';

test.describe('Authenticated browser runtime', () => {
  test('anonymous opens dashboard → redirect to login, no generic load error', async ({ page }) => {
    await page.goto('/dashboard-today');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.getByTestId('auth-login')).toBeVisible();
    await expect(page.getByText('Не удалось загрузить данные на сегодня')).toHaveCount(0);
  });

  test('registration → cookie → dashboard/meal/assistant work', async ({ page, context }) => {
    const email = `runtime-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

    const cookies = await context.cookies('http://localhost:3001');
    const session = cookies.find((c) => c.name === 'wa_session_local' || c.name === 'wa_session');
    expect(session).toBeTruthy();
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBeFalsy();

    const me = await page.request.get(`${api}/auth/me`);
    expect(me.status()).toBe(200);

    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: resolve(screenshotsDir, '90-dashboard-auth.png'), fullPage: true });

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-plan-heading').or(page.getByRole('heading').first())).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Не удалось загрузить план питания')).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshotsDir, '91-meal-plan-auth.png'), fullPage: true });

    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-heading')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('assistant-context-usage')).toBeVisible();
    await page.getByTestId('assistant-input').fill('Привет');
    await page.getByTestId('assistant-send').click();
    await expect(page.getByTestId('assistant-status')).toBeAttached({ timeout: 15000 });
    await page.screenshot({ path: resolve(screenshotsDir, '92-assistant-auth.png'), fullPage: true });

    await page.reload();
    await expect(page.getByTestId('assistant-heading')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('auth-user-email')).toContainText(email);

    await page.getByTestId('auth-logout').click();
    await page.waitForURL('**/login**', { timeout: 15000 });
    await page.goto('/dashboard-today');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });

  test('USER nav hides admin and prices', async ({ page }) => {
    const email = `user-nav-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30000 });
    await expect(page.getByTestId('nav-owner')).toHaveCount(0);
    await expect(page.getByTestId('nav-prices')).toHaveCount(0);
  });
});
