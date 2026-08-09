import { expect, test } from '@playwright/test';

const web = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const ownerUser = process.env.OWNER_SMOKE_USERNAME ?? 'zapolnaya28';
const ownerPass = process.env.OWNER_SMOKE_PASSWORD ?? '';

test.describe('Browser auth BFF cookie chain', () => {
  test('login through web BFF stores session on :3000 and opens OWNER dashboard', async ({ page, context }) => {
    test.skip(!ownerPass, 'OWNER_SMOKE_PASSWORD required');

    const loginRequests: { url: string; method: string }[] = [];
    const meRequests: { url: string; status?: number }[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/auth/login')) loginRequests.push({ url, method: req.method() });
      if (url.includes('/api/auth/me')) meRequests.push({ url });
    });

    page.on('response', async (res) => {
      if (res.url().includes('/api/auth/me')) {
        meRequests.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(`${web}/login`);
    await expect(page.getByTestId('auth-submit').or(page.locator('button[type="submit"]')).first()).toBeVisible({
      timeout: 120_000,
    });
    await page.getByTestId('auth-email').fill(ownerUser);
    await page.getByTestId('auth-password').fill(ownerPass);
    await page.getByTestId('auth-submit').click();

    await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });
    await expect(page.getByTestId('app-brand')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('auth-mfa-code')).toHaveCount(0);
    await expect(page.getByTestId('auth-mfa-challenge')).toHaveCount(0);

    expect(loginRequests.some((r) => r.method === 'POST' && r.url.includes('/api/auth/login'))).toBeTruthy();
    expect(loginRequests.some((r) => r.url.includes(':3001/api/v1/auth/login'))).toBeFalsy();

    const cookies = await context.cookies(web);
    const session = cookies.find((c) => c.name === 'wa_session_local' || c.name === 'wa_session');
    expect(session).toBeTruthy();
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBeFalsy();

    expect(meRequests.some((r) => r.url.includes('/api/auth/me') && r.status === 200)).toBeTruthy();
  });
});
