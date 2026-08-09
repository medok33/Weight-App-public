import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/workout/screenshots/workout-v2-01b');
const password = 'WorkoutV201bHubPass1!';
const fatal: string[] = [];

fs.mkdirSync(SHOT_DIR, { recursive: true });

function attachGuards(page: Page) {
  page.on('pageerror', (error) => fatal.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource: the server responded with a status of [45]\d\d/i.test(text)) return;
    if (/Download the React DevTools|\[HMR\]|Fast Refresh/i.test(text)) return;
    fatal.push(`console.error: ${text}`);
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

test.describe('WORKOUT-V2-01B workout hub and profile', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('profile → generate → today/week → replace → persist', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `workout-v2-01b-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.goto('/workout-engine?tab=plan');
    await expect(page.getByTestId('workout-my-plan')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('workout-profile-place').selectOption('HOME');
    await page.getByTestId('workout-profile-level').selectOption('BEGINNER');
    await page.getByTestId('workout-profile-frequency').selectOption('3');

    for (const day of [0, 2, 4]) {
      const checkbox = page.getByTestId(`workout-profile-day-${day}`);
      if (!(await checkbox.isChecked())) await checkbox.check();
    }
    for (const day of [1, 3, 5, 6]) {
      const checkbox = page.getByTestId(`workout-profile-day-${day}`);
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }

    await page.getByTestId('workout-profile-save').click();
    await expect(page.getByTestId('workout-live')).toContainText(/сохран|saved/i);
    await shot(page, '01-my-plan-saved');

    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-today')).toBeVisible();
    await shot(page, '02-today');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    const replaceTrigger = page.getByTestId(/workout-change-today-/).first();
    if (await replaceTrigger.isVisible().catch(() => false)) {
      await replaceTrigger.click();
      const option = page.getByTestId(/workout-change-option-/).first();
      if (await option.isVisible().catch(() => false)) {
        page.once('dialog', (dialog) => void dialog.accept());
        await option.click();
        await expect(page.getByTestId('workout-replacement-undo')).toBeVisible({ timeout: 30_000 });
        await shot(page, '03-replacement-applied');
        await page.getByTestId('workout-replacement-undo').click();
        await expect(page.getByTestId('workout-live')).toContainText(/отмен|undone/i);
      }
    }

    await page.getByTestId('workout-tab-week').click();
    await expect(page.getByTestId('workout-week')).toBeVisible();
    await expect(page.getByTestId('workout-day-0')).toBeVisible();
    await shot(page, '04-week');

    await page.reload();
    await expect(page.getByTestId('workout-week')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-day-0')).toBeVisible();
    await shot(page, '05-reload-persisted');

  });
});
