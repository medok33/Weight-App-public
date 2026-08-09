import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

/**
 * ACTIVITY-01B — connection lifecycle & sync status on Settings (read-only web).
 * Sync/consent fixtures use authenticated API harness (not a public seed).
 */

const password = 'Activity01bConnPass1!';
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

async function assertNoManualOrWebConnect(page: Page) {
  await expect(page.getByRole('button', { name: /указать шаги|enter steps/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(подключить|connect)$/i })).toHaveCount(0);
  await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(0);
  await expect(page.locator('[data-testid*="manual"]')).toHaveCount(0);
  await expect(page.getByTestId('settings-activity-disconnect-apple')).toHaveCount(0);
}

async function grantConsentAndSync(page: Page, steps: number) {
  const consent = await page.request.post('/api/v1/integrations/consents/grant', {
    data: {
      providerId: 'apple_health',
      dataCategory: 'activity',
      direction: 'READ',
      purpose: 'activity-sync-e2e-01b',
      consentVersion: '01b',
      source: 'test',
    },
  });
  expect(consent.ok(), await consent.text()).toBeTruthy();

  const todayRes = await page.request.get('/api/v1/activity/today');
  expect(todayRes.ok()).toBeTruthy();
  const today = (await todayRes.json()) as { localDate: string; timeZone: string };

  const sync = await page.request.post('/api/v1/activity/sync/steps', {
    data: {
      operationId: `e2e-01b-${Date.now()}`,
      source: 'HEALTHKIT',
      clientInstanceId: 'e2e-01b-iphone-01',
      sequence: 1,
      timeZone: today.timeZone,
      snapshots: [
        {
          localDate: today.localDate,
          steps,
          sourceCalculatedAt: new Date().toISOString(),
        },
      ],
    },
  });
  expect(sync.ok(), await sync.text()).toBeTruthy();
}

test.describe('ACTIVITY-01B connection lifecycle settings', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('no consent: honest status + mobile-only hint; no manual/web connect', async ({ page }) => {
    const email = `activity-01b-empty-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await page.goto('/settings');
    await expect(page.getByTestId('settings-activity-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('settings-activity-connection-apple')).toContainText(
      /не подключено|not connected/i,
    );
    await expect(page.getByTestId('settings-activity-consent-apple')).toContainText(
      /не выдано|not granted/i,
    );
    await expect(page.getByTestId('settings-activity-hint-apple')).toContainText(
      /Разрешите чтение активности|Allow activity read/i,
    );
    await assertNoManualOrWebConnect(page);
  });

  test('connected fixture → disconnect keeps Today history; reload persists', async ({ page }) => {
    const email = `activity-01b-disc-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await grantConsentAndSync(page, 6543);

    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(/6[\s\u00a0,]?543/, {
      timeout: 30_000,
    });

    await page.goto('/settings');
    await expect(page.getByTestId('settings-activity-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('settings-activity-connection-apple')).toContainText(
      /подключено|connected/i,
    );
    await expect(page.getByTestId('settings-activity-last-sync-apple')).not.toContainText(
      /ещё не было|never/i,
    );
    await expect(page.getByTestId('settings-activity-disconnect-apple')).toBeVisible();

    await page.getByTestId('settings-activity-disconnect-apple').click();
    await expect(page.getByTestId('settings-activity-connection-apple')).toContainText(
      /отключено|disconnected/i,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('settings-activity-hint-apple')).toContainText(
      /сохранены|kept/i,
    );

    await page.reload();
    await expect(page.getByTestId('settings-activity-connection-apple')).toContainText(
      /отключено|disconnected/i,
    );

    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-activity-steps')).toContainText(/6[\s\u00a0,]?543/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('dashboard-activity-steps')).not.toHaveText(/^0$/);
    await expect(page.getByTestId('dashboard-activity-empty')).toHaveCount(0);
  });

  test('USER isolation: connections endpoint is self-scoped', async ({ page, browser }) => {
    const emailA = `activity-01b-a-${Date.now()}@example.com`;
    const emailB = `activity-01b-b-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, emailA, password);
    await grantConsentAndSync(page, 1111);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    attachGuards(pageB);
    await registerAndCompleteOnboarding(pageB, emailB, password);
    await pageB.goto('/settings');
    await expect(pageB.getByTestId('settings-activity-connection-apple')).toContainText(
      /не подключено|not connected/i,
    );

    const res = await pageB.request.get('/api/v1/activity/connections');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      providers: Array<{ source: string; connectionState: string }>;
    };
    expect(body.providers.find((p) => p.source === 'HEALTHKIT')?.connectionState).toBe(
      'NOT_CONNECTED',
    );
    await contextB.close();
  });
});
