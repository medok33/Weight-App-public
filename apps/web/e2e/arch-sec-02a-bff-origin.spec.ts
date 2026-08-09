import { expect, test, type PlaywrightWorkerArgs } from '@playwright/test';

const web = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const origin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3000';
const password = 'Password12345';

async function registerSession(playwright: PlaywrightWorkerArgs['playwright']) {
  const email = `bff-csrf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const ctx = await playwright.request.newContext({
    extraHTTPHeaders: { Origin: origin, 'content-type': 'application/json' },
  });
  const register = await ctx.post(`${api}/auth/register`, { data: { email, password } });
  expect(register.ok()).toBeTruthy();
  const payload = (await register.json()) as { user?: { id?: string } };
  return { ctx, email, userId: payload.user?.id };
}

test.describe('ARCH-SEC-02A Next.js BFF CSRF boundary', () => {
  test('A: foreign Origin POST to BFF mutation is 403 and does not create export job', async ({
    playwright,
  }) => {
    const { ctx } = await registerSession(playwright);
    const state = await ctx.storageState();

    const before = await ctx.get(`${api}/export-share/jobs`);
    const beforeCount = before.ok()
      ? ((await before.json()) as { items?: unknown[] }).items?.length ?? 0
      : 0;

    const attack = await playwright.request.newContext({
      storageState: state,
      baseURL: web,
      extraHTTPHeaders: {
        Origin: 'https://evil.example',
        'content-type': 'application/json',
      },
    });

    const blocked = await attack.post('/api/export-share/jobs', {
      data: { type: 'SHOPPING_LIST_PDF', idempotencyKey: `bff-csrf-${Date.now()}` },
    });
    expect(blocked.status()).toBe(403);
    const body = await blocked.json();
    expect(JSON.stringify(body)).toMatch(/CSRF_ORIGIN_REJECTED/);

    const after = await ctx.get(`${api}/export-share/jobs`);
    if (after.ok()) {
      const afterCount = ((await after.json()) as { items?: unknown[] }).items?.length ?? 0;
      expect(afterCount).toBe(beforeCount);
    }

    await attack.dispose();
    await ctx.dispose();
  });

  test('B: missing Origin/Referer on BFF mutation rejected', async ({ playwright }) => {
    const { ctx } = await registerSession(playwright);
    const state = await ctx.storageState();
    const noOrigin = await playwright.request.newContext({
      storageState: state,
      baseURL: web,
      extraHTTPHeaders: { 'content-type': 'application/json', Origin: '' },
    });
    const blocked = await noOrigin.post('/api/payments/checkout', {
      data: { offerKey: 'premium_month' },
      headers: { Origin: '' },
    });
    expect(blocked.status()).toBe(403);
    const body = await blocked.json();
    expect(JSON.stringify(body)).toMatch(/CSRF_ORIGIN_REJECTED/);
    await noOrigin.dispose();
    await ctx.dispose();
  });

  test('C: allowlisted Origin reaches BFF (auth gate, not CSRF)', async ({ playwright }) => {
    const { ctx } = await registerSession(playwright);
    const state = await ctx.storageState();
    const okCtx = await playwright.request.newContext({
      storageState: state,
      baseURL: web,
      extraHTTPHeaders: { Origin: origin, 'content-type': 'application/json' },
    });
    // USER calling ADMIN BFF should not be CSRF-rejected; may be 401/403 RBAC.
    const res = await okCtx.post('/api/admin/recipe-sources', {
      data: {
        code: `bff_ok_${Date.now().toString(36)}`,
        name: 'BFF CSRF allow',
        baseUrl: 'https://example.com',
        adapterType: 'NOT_CONFIGURED',
      },
    });
    const text = await res.text();
    expect(text).not.toMatch(/CSRF_ORIGIN_REJECTED/);
    // RBAC may return 401/403; only CSRF origin rejection is forbidden here.
    if (res.status() === 403) {
      expect(text).not.toMatch(/CSRF_ORIGIN/);
    }
    await okCtx.dispose();
    await ctx.dispose();
  });

  test('D: similar hostname rejected on BFF DELETE', async ({ playwright }) => {
    const { ctx } = await registerSession(playwright);
    const state = await ctx.storageState();
    const attack = await playwright.request.newContext({
      storageState: state,
      baseURL: web,
      extraHTTPHeaders: {
        Origin: 'https://weight-app.ru.attacker.example',
        'content-type': 'application/json',
      },
    });
    const blocked = await attack.delete(
      '/api/export-share/share-links/00000000-0000-0000-0000-000000000001',
    );
    expect(blocked.status()).toBe(403);
    expect(JSON.stringify(await blocked.json())).toMatch(/CSRF_ORIGIN_REJECTED/);
    await attack.dispose();
    await ctx.dispose();
  });

  test('E: forged x-session-token header alone cannot bypass BFF Origin gate', async ({
    request,
  }) => {
    const res = await request.post(`${web}/api/export-share/jobs`, {
      headers: {
        Origin: 'https://evil.example',
        'content-type': 'application/json',
        'x-session-token': 'forged-token-value',
      },
      data: { type: 'SHOPPING_LIST_PDF', idempotencyKey: `forge-${Date.now()}` },
    });
    expect(res.status()).toBe(403);
  });

  test('F-USER: allow Origin PASS / foreign Origin REJECT on USER BFF mutation', async ({
    playwright,
  }) => {
    const { ctx } = await registerSession(playwright);
    const state = await ctx.storageState();

    const allow = await playwright.request.newContext({
      storageState: state,
      baseURL: web,
      extraHTTPHeaders: { Origin: origin, 'content-type': 'application/json' },
    });
    const pass = await allow.post('/api/payments/checkout', {
      data: { offerKey: 'premium_month' },
    });
    expect(pass.status()).not.toBe(403);
    expect(await pass.text()).not.toMatch(/CSRF_ORIGIN_REJECTED/);

    const deny = await playwright.request.newContext({
      storageState: state,
      baseURL: web,
      extraHTTPHeaders: { Origin: 'https://evil.example', 'content-type': 'application/json' },
    });
    const rejected = await deny.post('/api/payments/checkout', {
      data: { offerKey: 'premium_month' },
    });
    expect(rejected.status()).toBe(403);

    await allow.dispose();
    await deny.dispose();
    await ctx.dispose();
  });

  test('F-ADMIN: allow Origin PASS / foreign Origin REJECT on ADMIN BFF mutation', async ({
    playwright,
  }) => {
    // Origin gate runs before cookie read; CSRF proof does not require an ADMIN session.
    const allow = await playwright.request.newContext({
      baseURL: web,
      extraHTTPHeaders: { Origin: origin, 'content-type': 'application/json' },
    });
    const pass = await allow.post('/api/admin/recipe-sources', {
      data: {
        code: `admin_bff_${Date.now().toString(36)}`,
        name: 'Admin BFF allow',
        baseUrl: 'https://example.com',
        adapterType: 'NOT_CONFIGURED',
        dataClass: 'TEST_ONLY',
      },
    });
    expect(pass.status()).not.toBe(403);
    expect(await pass.text()).not.toMatch(/CSRF_ORIGIN_REJECTED/);

    const deny = await playwright.request.newContext({
      baseURL: web,
      extraHTTPHeaders: { Origin: 'https://evil.example', 'content-type': 'application/json' },
    });
    const rejected = await deny.post('/api/admin/recipe-sources', {
      data: {
        code: `admin_bff_bad_${Date.now().toString(36)}`,
        name: 'Admin BFF deny',
        baseUrl: 'https://example.com',
        adapterType: 'NOT_CONFIGURED',
      },
    });
    expect(rejected.status()).toBe(403);
    expect(JSON.stringify(await rejected.json())).toMatch(/CSRF_ORIGIN_REJECTED/);

    await allow.dispose();
    await deny.dispose();
  });

  test('F-OWNER: allow Origin PASS / foreign Origin REJECT on OWNER BFF mutation', async ({
    playwright,
  }) => {
    // Origin gate runs before cookie read; CSRF proof does not require an OWNER session.
    const allow = await playwright.request.newContext({
      baseURL: web,
      extraHTTPHeaders: { Origin: origin, 'content-type': 'application/json' },
    });
    const pass = await allow.post('/api/owner-admin/feature-flags', { data: {} });
    expect(pass.status()).not.toBe(403);
    expect(await pass.text()).not.toMatch(/CSRF_ORIGIN_REJECTED/);

    const deny = await playwright.request.newContext({
      baseURL: web,
      extraHTTPHeaders: { Origin: 'https://evil.example', 'content-type': 'application/json' },
    });
    const rejected = await deny.post('/api/owner-admin/feature-flags', { data: {} });
    expect(rejected.status()).toBe(403);
    expect(JSON.stringify(await rejected.json())).toMatch(/CSRF_ORIGIN_REJECTED/);

    await allow.dispose();
    await deny.dispose();
  });
});
