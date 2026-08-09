import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

/**
 * ACTIVITY-01A — automatic provider steps on Today (read-only UI).
 * Sync is performed via authenticated API harness (not a public seed endpoint).
 */

const password = 'Activity01aSyncPass1!';
const fatal: string[] = [];

/** RU (6 800 / 6\u00a0800) and EN (6,800) thousand separators. */
function stepsPattern(n: number): RegExp {
  const raw = String(n);
  if (raw.length <= 3) return new RegExp(raw);
  const head = raw.slice(0, -3);
  const tail = raw.slice(-3);
  return new RegExp(`${head}[\\s\\u00a0,]?${tail}`);
}

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

async function assertNoManualControls(page: Page) {
  await expect(page.getByRole('button', { name: /указать шаги|enter steps|edit|delete|connect/i })).toHaveCount(0);
  await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(0);
  await expect(page.locator('form[data-testid*="activity"]')).toHaveCount(0);
  await expect(page.locator('[data-testid*="manual"]')).toHaveCount(0);
}

async function grantConsentAndSync(
  page: Page,
  opts: { steps: number; operationId: string; sequence: number },
) {
  const consent = await page.request.post('/api/v1/integrations/consents/grant', {
    data: {
      providerId: 'apple_health',
      dataCategory: 'activity',
      direction: 'READ',
      purpose: 'activity-sync-e2e',
      consentVersion: '01a',
      source: 'test',
    },
  });
  expect(consent.ok(), await consent.text()).toBeTruthy();

  const todayRes = await page.request.get('/api/v1/activity/today');
  expect(todayRes.ok()).toBeTruthy();
  const today = (await todayRes.json()) as { localDate: string; timeZone: string };

  const sync = await page.request.post('/api/v1/activity/sync/steps', {
    data: {
      operationId: opts.operationId,
      source: 'HEALTHKIT',
      clientInstanceId: 'e2e-iphone-client-01',
      sequence: opts.sequence,
      timeZone: today.timeZone,
      snapshots: [
        {
          localDate: today.localDate,
          steps: opts.steps,
          sourceCalculatedAt: new Date().toISOString(),
        },
      ],
    },
  });
  expect(sync.ok(), await sync.text()).toBeTruthy();
}

test.describe('ACTIVITY-01A automatic steps Today', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('no-data → sync → replace → lower correction; no manual controls; RU/EN; a11y/overflow', async ({
    page,
  }) => {
    const email = `activity-01a-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-activity-block')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-activity-empty')).toBeVisible();
    await expect(page.getByTestId('dashboard-activity-empty')).toHaveText(
      /не синхронизированы|not been synced/i,
    );
    await expect(page.getByTestId('dashboard-activity-empty')).not.toHaveText(/^0$/);
    await assertNoManualControls(page);

    await grantConsentAndSync(page, { steps: 6420, operationId: 'e2e-op-1', sequence: 1 });
    await page.reload();
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(stepsPattern(6420));
    await expect(page.getByTestId('dashboard-activity-source')).toContainText(/Apple Health/i);
    await expect(page.getByTestId('dashboard-activity-empty')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-activity-steps')).not.toHaveText(/^0$/);

    await grantConsentAndSync(page, { steps: 7000, operationId: 'e2e-op-2', sequence: 2 });
    await page.reload();
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(stepsPattern(7000));
    await expect(page.getByTestId('dashboard-activity-steps')).not.toContainText(/13/);
    await expect(page.getByTestId('dashboard-activity-steps')).not.toContainText(
      /13420|13[\s\u00a0,]?420/,
    );

    await grantConsentAndSync(page, { steps: 6800, operationId: 'e2e-op-3', sequence: 3 });
    await page.reload();
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(stepsPattern(6800));
    await expect(page.getByTestId('dashboard-activity-steps')).not.toContainText(stepsPattern(7000));
    await expect(page.getByTestId('dashboard-activity-steps')).not.toContainText(
      /13800|13[\s\u00a0,]?800|13420/,
    );
    await assertNoManualControls(page);

    await axeCriticalSerious(page, 'activity-today-desktop');
    expect(await pageOverflow(page)).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(stepsPattern(6800));
    expect(await pageOverflow(page)).toBe(0);
    await axeCriticalSerious(page, 'activity-today-mobile');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings');
    await page.getByTestId('profile-form').waitFor({ timeout: 30_000 });
    const persist = page.waitForResponse(
      (r) =>
        /\/api\/v1\/profile(?:\?|$)/.test(r.url()) &&
        r.request().method() === 'PUT' &&
        r.ok(),
      { timeout: 20_000 },
    );
    await page.getByTestId('profile-locale').selectOption('en');
    await page.getByTestId('profile-save').click();
    await persist;
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-activity-block')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(stepsPattern(6800));
    await expect(page.getByTestId('dashboard-activity-source')).toContainText(/Apple Health/i);
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
    await assertNoManualControls(page);
  });
});
