import { expect, test, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * RUNTIME-SMOKE-01 — USER route runtime smoke.
 *
 * HTTP 200 alone is not enough. Fail on:
 * - pageerror (incl. MISSING_I18N / MISSING_I18N_CONTENT)
 * - Next.js runtime overlay / client exception banner
 * - console.error that contains MISSING_I18N*
 * - same-origin /api/v1 responses with status >= 500
 *
 * Benign console noise (favicon/static 404 "Failed to load resource") is recorded
 * but does not fail the suite — those are tracked separately for the audit report.
 *
 * Uses a normal USER session (not OWNER).
 */

const USER_ROUTES = [
  '/',
  '/login',
  '/register',
  '/onboarding',
  '/dashboard-today',
  '/meal-plan',
  '/workout-engine',
  '/shopping-list',
  '/pantry',
  '/budget-mode',
  '/progress',
  '/assistant',
  '/settings',
  '/pricing',
  '/payments',
  '/nutrition-engine',
  '/export-share',
  '/revision-engine',
] as const;

const password = 'RuntimeSmoke1!';

type RouteResult = {
  path: string;
  ok: boolean;
  status?: number;
  fatal: string[];
  noise: string[];
};

function isNoiseConsoleError(text: string): boolean {
  if (/Download the React DevTools/i.test(text)) return true;
  if (/\[HMR\]/i.test(text)) return true;
  if (/Fast Refresh/i.test(text)) return true;
  // Browser logs every failed subresource as console.error without URL — treat as noise
  // unless paired with pageerror / overlay / API 5xx (handled separately).
  if (/Failed to load resource: the server responded with a status of 404/i.test(text)) return true;
  if (/Failed to load resource: the server responded with a status of 4\d\d/i.test(text)) return true;
  return false;
}

function isFatalConsoleError(text: string): boolean {
  if (/MISSING_I18N(_CONTENT)?:/i.test(text)) return true;
  if (/Application error: a client-side exception/i.test(text)) return true;
  return false;
}

async function attachRuntimeGuards(page: Page, fatal: string[], noise: string[]) {
  page.on('pageerror', (err) => {
    fatal.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isFatalConsoleError(text)) {
      fatal.push(`console.error: ${text}`);
      return;
    }
    if (isNoiseConsoleError(text)) {
      noise.push(`console.error: ${text}`);
      return;
    }
    fatal.push(`console.error: ${text}`);
  });
  page.on('request', (req) => {
    try {
      const url = req.url();
      // Browser must use same-origin BFF, never Nest :3001 directly.
      if (/^https?:\/\/(127\.0\.0\.1|localhost):3001\b/i.test(url)) {
        fatal.push(`direct-nest: ${url}`);
      }
    } catch {
      /* ignore */
    }
  });
  page.on('response', (res) => {
    try {
      const url = res.url();
      if (!url.includes('/api/v1/')) return;
      if (res.status() >= 500) fatal.push(`api5xx: ${res.status()} ${url}`);
    } catch {
      /* ignore */
    }
  });
  // Do not treat net::ERR_ABORTED as fatal — navigation/reload cancels in-flight fetches.
}

async function assertNoNextOverlay(page: Page, fatal: string[]) {
  const overlay = page.locator('#__next-build-error, nextjs-portal, [data-nextjs-dialog]');
  if (await overlay.count()) {
    const visible = await overlay.first().isVisible().catch(() => false);
    if (visible) fatal.push('next-overlay: visible runtime/build error dialog');
  }
  const body = await page.locator('body').innerText().catch(() => '');
  if (/MISSING_I18N(_CONTENT)?:/i.test(body)) {
    fatal.push(`i18n-in-body: ${body.match(/MISSING_I18N[_A-Z]*:[^\s]+/i)?.[0] ?? 'present'}`);
  }
  if (/Application error: a client-side exception/i.test(body)) {
    fatal.push('next-fatal: client-side exception banner');
  }
}

async function registerUser(page: Page, email: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 45_000 });
  // Complete first-run wizard so guarded USER routes are reachable.
  await page.getByTestId('onboarding-continue').click();
  await page.getByTestId('onboarding-name').fill('Runtime Smoke User');
  await page.getByTestId('onboarding-age').fill('32');
  await page.getByTestId('onboarding-height').fill('175');
  await page.getByTestId('onboarding-weight').fill('80');
  await page.getByTestId('onboarding-continue').click();
  await page.getByTestId('onboarding-goal-target').fill('75');
  await page.getByTestId('onboarding-continue').click();
  await page.getByTestId('onboarding-skip').click();
  await page.getByTestId('onboarding-continue').click();
  await page.waitForURL((url) => url.pathname.includes('dashboard-today'), { timeout: 60_000 });
}

test.describe('RUNTIME-SMOKE-01 USER routes', () => {
  test('authenticated USER can open core routes without runtime/i18n crashes', async ({ page }) => {
    // Onboarding + route×reload matrix exceeds the default 90s locally/CI.
    test.setTimeout(180_000);
    const email = `runtime-smoke-${Date.now()}@example.com`;
    await registerUser(page, email);

    await page.goto('/settings');
    if (await page.getByTestId('profile-form').isVisible().catch(() => false)) {
      // Profile already seeded by onboarding; keep smoke resilient if form present.
      await page.getByTestId('profile-status').waitFor({ timeout: 5_000 }).catch(() => undefined);
    }

    await page.goto('/shopping-list');
    const generate = page.getByTestId('shopping-generate');
    if (await generate.isVisible().catch(() => false)) {
      await generate.click();
      await page.waitForTimeout(2500);
    }

    // Warm dashboard once so concurrent plan creation races settle before the matrix.
    await page.goto('/dashboard-today', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const fatal: string[] = [];
    const noise: string[] = [];
    await attachRuntimeGuards(page, fatal, noise);

    const results: RouteResult[] = [];
    for (const path of USER_ROUTES) {
      fatal.length = 0;
      noise.length = 0;
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      const status = response?.status();
      if (status && status >= 500) fatal.push(`http: ${status}`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(400);
      await assertNoNextOverlay(page, fatal);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(300);
      await assertNoNextOverlay(page, fatal);
      results.push({
        path,
        ok: fatal.length === 0,
        status,
        fatal: [...fatal],
        noise: [...noise],
      });
    }

    fatal.length = 0;
    noise.length = 0;
    await page.goto('/shopping-list');
    await page.waitForTimeout(1000);
    await assertNoNextOverlay(page, fatal);
    if (await page.getByTestId('shopping-items').isVisible().catch(() => false)) {
      const text = await page.getByTestId('shopping-items').innerText();
      expect(text).not.toMatch(/MISSING_I18N/i);
      expect(await page.getByTestId('shopping-items').locator('li').count()).toBeGreaterThan(0);
    }

    const failed = [
      ...results.filter((r) => !r.ok),
      ...(fatal.length
        ? [{ path: '/shopping-list#items', ok: false, fatal: [...fatal], noise: [...noise], status: undefined }]
        : []),
    ];

    console.log(
      'RUNTIME_SMOKE_MATRIX',
      JSON.stringify(
        results.map((r) => ({
          path: r.path,
          status: r.status,
          ok: r.ok,
          fatal: r.fatal,
          noiseCount: r.noise.length,
        })),
        null,
        2,
      ),
    );

    expect(failed, `Broken USER routes: ${JSON.stringify(failed, null, 2)}`).toEqual([]);
  });
});
