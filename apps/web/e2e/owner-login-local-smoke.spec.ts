import { expect, test } from '@playwright/test';

const web = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const origin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
const ownerUser = process.env.OWNER_SMOKE_USERNAME ?? 'zapolnaya28';
const ownerPass = process.env.OWNER_SMOKE_PASSWORD ?? '';

test.describe('OWNER login local smoke', () => {
  test('/login renders without runtime error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${web}/login`);
    await expect(page.getByTestId('auth-submit').or(page.locator('button[type="submit"]')).first()).toBeVisible({
      timeout: 15_000,
    });
    expect(errors.join('\n')).not.toMatch(/admin is not defined/i);
  });

  test('invalid credentials return public error without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${web}/login`);
    await page.locator('input[name="identifier"], input[type="email"], input[type="text"]').first().fill('nobody@example.test');
    await page.locator('input[name="password"], input[type="password"]').first().fill('DefinitelyWrongPass1!');
    await page.locator('button[type="submit"]').first().click();
    await expect(page.getByTestId('auth-error')).toBeVisible({ timeout: 15_000 });
    expect(errors.join('\n')).not.toMatch(/admin is not defined/i);
  });

  test('valid LOCAL OWNER password login creates full OWNER session without MFA', async ({ request }) => {
    test.skip(!ownerPass, 'OWNER_SMOKE_PASSWORD required');
    const res = await request.post(`${api}/auth/login`, {
      headers: { Origin: origin, 'content-type': 'application/json' },
      data: { identifier: ownerUser, password: ownerPass },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/MFA_ENROLLMENT_REQUIRED|MFA_CHALLENGE_REQUIRED/);
    expect(body?.user?.role ?? body?.role).toBe('OWNER');
    const setCookie = res.headers()['set-cookie'] ?? '';
    expect(String(setCookie).length).toBeGreaterThan(10);
  });

  test('login UI accepts username zapolnaya28 and opens full app without MFA', async ({ page, context }) => {
    test.skip(!ownerPass, 'OWNER_SMOKE_PASSWORD required');
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(`${web}/login`);
    await expect(page.getByTestId('auth-submit')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);

    const loginResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/api/auth/login') &&
        !res.url().includes(':3001/') &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30_000 },
    );
    const meResponsePromise = page.waitForResponse(
      (res) => res.request().method() === 'GET' && res.url().includes('/api/auth/me') && res.status() === 200,
      { timeout: 30_000 },
    );

    await page.getByTestId('auth-submit').click();

    const loginResponse = await loginResponsePromise;
    expect([200, 201]).toContain(loginResponse.status());
    const loginBody = await loginResponse.json();
    expect(JSON.stringify(loginBody)).not.toMatch(/MFA_ENROLLMENT_REQUIRED|MFA_CHALLENGE_REQUIRED/);

    await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
    const meResponse = await meResponsePromise;
    expect(meResponse.status()).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody?.user?.role ?? meBody?.role).toBe('OWNER');

    const cookies = await context.cookies(web);
    const sessionOnWeb = cookies.find((c) => c.name === 'wa_session_local' || c.name === 'wa_session');
    expect(sessionOnWeb).toBeTruthy();
    expect(sessionOnWeb?.httpOnly).toBe(true);

    await expect(page.getByTestId('app-brand')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('auth-role-badge')).toHaveText('OWNER');
    await expect(page.locator('aside.app-nav nav')).toBeVisible();
    await expect(page.getByTestId('auth-mfa-challenge')).toHaveCount(0);
    await expect(page.getByTestId('auth-mfa-code')).toHaveCount(0);
    expect(errors.join('\n')).not.toMatch(/admin is not defined/i);
  });

  test('AppShell dashboard renders without admin is not defined', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${web}/dashboard-today`);
    await expect(page.getByTestId('app-brand')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('aside.app-nav nav')).toBeVisible();
    expect(errors.join('\n')).not.toMatch(/admin is not defined/i);
  });
});
