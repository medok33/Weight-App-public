import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

/**
 * WORKOUT-V2-01A — initial plan foundation browser flow
 * (updated for 01B hub tabs: Today / Week / My Plan).
 */

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/workout/screenshots/workout-v2-01a');
const password = 'WorkoutV201aPlanPass1!';

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

test.describe('WORKOUT-V2-01A initial plan foundation', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('setup → generate → persist → reload → dashboard', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `workout-v2-01a-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.goto('/workout-engine');
    await expect(page.getByTestId('workout-engine-main')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-engine-empty')).toBeVisible();
    await shot(page, '01-empty-ready');
    await axeCriticalSerious(page, 'workout-empty');

    await page.getByTestId('workout-tab-plan').click();
    await expect(page.getByTestId('workout-my-plan')).toBeVisible();
    await expect(page.getByTestId('workout-generate')).toBeVisible();
    await shot(page, '02-my-plan-ready');

    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-week').click();
    await expect(page.getByTestId('workout-plan')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-plan-version')).toContainText(/1|Версия|Version/i);
    await expect(page.getByTestId('workout-day-0')).toBeVisible();
    const versionText = await page.getByTestId('workout-plan-version').innerText();
    await shot(page, '03-generated-plan');
    await axeCriticalSerious(page, 'workout-plan');

    for (const width of [360, 390, 430, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await pageOverflow(page), `overflow@${width}`).toBe(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.reload();
    await expect(page.getByTestId('workout-tab-week')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('workout-tab-week').click();
    await expect(page.getByTestId('workout-plan')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-plan-version')).toHaveText(versionText);
    await shot(page, '04-reload-persisted');

    await page.goto('/dashboard-today');
    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 30_000 });
    const workoutCard = page.getByTestId('dashboard-qa-workout');
    await expect(workoutCard).toBeVisible();
    await expect(workoutCard).not.toContainText(/не запланировано|not planned/i);
    await shot(page, '05-dashboard-linked');
  });
});
