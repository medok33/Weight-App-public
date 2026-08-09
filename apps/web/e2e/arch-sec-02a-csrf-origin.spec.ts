import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const origin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
const password = 'Password12345';

test.describe('ARCH-SEC-02A CSRF origin / cookie', () => {
  test('login/me/logout with allowlisted Origin; cookie-auth mutation without Origin rejected', async ({
    playwright,
  }) => {
    const email = `csrf-${Date.now()}@test.com`;
    const ctx = await playwright.request.newContext({
      extraHTTPHeaders: { Origin: origin, 'content-type': 'application/json' },
    });

    const register = await ctx.post(`${api}/auth/register`, {
      data: { email, password },
    });
    if (!register.ok()) {
      throw new Error(`register failed: ${register.status()} ${await register.text()}`);
    }

    const me = await ctx.get(`${api}/auth/me`);
    expect(me.status()).toBe(200);

    // Foreign Origin with session cookie → must fail CSRF/origin guard.
    const foreign = await playwright.request.newContext({
      storageState: await ctx.storageState(),
      extraHTTPHeaders: { Origin: 'https://evil.example', 'content-type': 'application/json' },
    });
    const blocked = await foreign.post(`${api}/auth/logout`, { data: {} });
    expect(blocked.status()).toBe(403);
    const body = await blocked.json();
    expect(JSON.stringify(body)).toMatch(/CSRF_ORIGIN_REJECTED/);

    // Missing Origin (override global Playwright Origin header) with cookie → reject.
    const noOrigin = await playwright.request.newContext({
      storageState: await ctx.storageState(),
      extraHTTPHeaders: { 'content-type': 'application/json', Origin: '' },
    });
    const blockedMissing = await noOrigin.post(`${api}/auth/logout`, {
      data: {},
      headers: { Origin: '' },
    });
    // Empty Origin is treated as absent/invalid → reject when cookie present.
    expect(blockedMissing.status()).toBe(403);

    // Allowed Origin still works.
    const logout = await ctx.post(`${api}/auth/logout`, { data: {} });
    expect(logout.ok()).toBeTruthy();

    await foreign.dispose();
    await noOrigin.dispose();
    await ctx.dispose();
  });

  test('payment webhook exemption accepts missing Origin (signature still required)', async ({
    request,
  }) => {
    const res = await request.post(`${api}/payments/webhook`, {
      headers: {
        // Intentionally no Origin — CSRF exempt; signature must still validate.
        'content-type': 'application/json',
      },
      data: { id: 'evt-csrf', type: 'payment.updated' },
    });
    // Signature missing → 401/400 from webhook verifier, not CSRF 403.
    expect(res.status()).not.toBe(403);
    expect([400, 401]).toContain(res.status());
  });

  test('OPTIONS allowlisted Origin is not blocked by CSRF guard', async ({ request }) => {
    const res = await request.fetch(`${api}/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('OPTIONS foreign Origin is handled by CORS (not CSRF 403)', async ({ request }) => {
    const res = await request.fetch(`${api}/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    // CSRF guard skips non-unsafe methods; CORS must not reflect foreign Origin.
    expect(res.status()).not.toBe(403);
    const allowOrigin = res.headers()['access-control-allow-origin'];
    expect(allowOrigin === undefined || allowOrigin !== 'https://evil.example').toBeTruthy();
  });
});