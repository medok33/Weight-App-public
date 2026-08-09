import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

const password = 'WorkoutV201eHubPass1!';
const fatal: string[] = [];

function todayDayIndex(now = new Date()): number {
  return (now.getDay() + 6) % 7;
}

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

async function saveProfileDays(page: Page, selectedDays: number[]) {
  const selected = new Set(selectedDays);
  await page.getByTestId('workout-profile-place').selectOption('HOME');
  await page.getByTestId('workout-profile-level').selectOption('BEGINNER');
  await page.getByTestId('workout-profile-frequency').selectOption(String(selected.size));

  for (let day = 0; day <= 6; day += 1) {
    const checkbox = page.getByTestId(`workout-profile-day-${day}`);
    const want = selected.has(day);
    if (want && !(await checkbox.isChecked())) await checkbox.check();
    if (!want && (await checkbox.isChecked())) await checkbox.uncheck();
  }

  await page.getByTestId('workout-profile-save').click();
  await expect(page.getByTestId('workout-live')).toContainText(/сохран|saved/i);
}

async function saveProfileForToday(page: Page) {
  const today = todayDayIndex();
  const extras = [0, 2, 4].filter((day) => day !== today).slice(0, 2);
  await saveProfileDays(page, [today, ...extras]);
}

async function saveProfileRestToday(page: Page) {
  const today = todayDayIndex();
  const days = [0, 2, 4].filter((day) => day !== today).slice(0, 3);
  while (days.length < 3) {
    const candidate = (days[days.length - 1]! + 1) % 7;
    if (candidate !== today && !days.includes(candidate)) days.push(candidate);
  }
  await saveProfileDays(page, days);
}

async function generatePlan(page: Page) {
  await page.goto('/workout-engine?tab=plan');
  await expect(page.getByTestId('workout-my-plan')).toBeVisible({ timeout: 30_000 });
}

async function assertOverflowZero(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('WORKOUT-V2-01E hub Today UX', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('scheduled: one Start, secondary Change today, no metadata', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `workout-v2-01e-sched-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await generatePlan(page);
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-today')).toBeVisible();
    await expect(page.getByTestId('workout-start')).toHaveCount(1);
    await expect(page.getByTestId('workout-continue')).toHaveCount(0);
    await expect(page.getByTestId(/workout-change-today-/)).toHaveCount(1);
    await expect(page.getByTestId('workout-start')).toHaveClass(/ui-cta/);
    await expect(page.getByTestId(/workout-change-today-/)).not.toHaveClass(/ui-cta/);
    await expect(page.getByTestId(/workout-change-today-/)).toHaveClass(/ui-button-secondary/);
    await expect(page.getByTestId('workout-today')).not.toContainText(/Version|revision|MOVE_DAY|HOME_SHORT/i);
    await expect(page.getByTestId('workout-plan-version')).toHaveCount(0);

    const technique = page.getByRole('button', { name: /Показать технику|Show technique/i }).first();
    await expect(technique).toBeVisible();
    await technique.click();
    await expect(page.getByTestId('workout-exercise-panel')).toBeVisible();
    await expect(page.locator('img')).toHaveCount(0);
    await page.getByRole('button', { name: /Закрыть|Close/i }).click();
  });

  test('active: Continue only opens exact session', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `workout-v2-01e-active-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await generatePlan(page);
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await page.getByTestId('workout-start').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    const sessionUrl = page.url();
    expect(sessionUrl).toMatch(/\/workout-engine\/session\//);

    await page.goto('/workout-engine?tab=today');
    await expect(page.getByTestId('workout-continue')).toHaveCount(1);
    await expect(page.getByTestId('workout-start')).toHaveCount(0);
    await expect(page.getByTestId('workout-continue')).toHaveClass(/ui-cta/);
    await page.getByTestId('workout-continue').click();
    await expect(page).toHaveURL(sessionUrl);
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
  });

  test('completed: no Start and no Continue', async ({ page }) => {
    test.setTimeout(300_000);
    const email = `workout-v2-01e-done-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await generatePlan(page);
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await page.getByTestId('workout-start').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 45_000 });

    await page.getByTestId('workout-session-complete').click();
    await expect(page.getByTestId('workout-session-live')).toContainText(/остал|left|finish|заверш/i, {
      timeout: 30_000,
    });
    await page.getByTestId('workout-session-complete').click();
    await expect(page.getByTestId('workout-session-result')).toContainText(/заверш|complet/i, {
      timeout: 30_000,
    });

    await page.goto('/workout-engine?tab=today');
    await expect(page.getByTestId('workout-today-completed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-start')).toHaveCount(0);
    await expect(page.getByTestId('workout-continue')).toHaveCount(0);
    await expect(page.getByTestId('workout-view-week')).toBeVisible();
  });

  test('rest: one secondary View week only', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `workout-v2-01e-rest-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await generatePlan(page);
    await saveProfileRestToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-today')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-start')).toHaveCount(0);
    await expect(page.getByTestId('workout-continue')).toHaveCount(0);
    await expect(page.getByTestId(/workout-change-today-/)).toHaveCount(0);
    await expect(page.getByTestId('workout-view-week')).toHaveCount(1);
  });

  test('Change today dialog a11y + soft refresh retention', async ({ page }) => {
    test.setTimeout(300_000);
    const email = `workout-v2-01e-change-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await generatePlan(page);
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-start')).toHaveCount(1);

    const trigger = page.getByTestId(/workout-change-today-/);
    await trigger.focus();
    await trigger.click();
    const sheet = page.getByTestId(/workout-change-today-sheet-/);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(sheet).not.toContainText('MOVE_DAY');
    await expect(sheet).not.toContainText('HOME_SHORT');

    const close = page.getByTestId('workout-change-today-close');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sheet.locator('button').nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Soft refresh while scheduled Start is still present (before Change today apply).
    await page.route('**/api/v1/workout-plan/today**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SOFT_FAIL', code: 'X_SOFT' }),
      });
    });
    await page.route('**/api/v1/workout-plan/week**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SOFT_FAIL', code: 'X_SOFT' }),
      });
    });
    await page.getByTestId('workout-tab-week').click();
    await expect(page.getByTestId('workout-soft-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-soft-error')).not.toContainText('SOFT_FAIL');
    await expect(page.getByTestId('workout-engine-error')).toHaveCount(0);
    await expect(page.getByTestId('workout-engine-main')).toBeVisible();
    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-today')).toBeVisible();
    await expect(page.getByTestId('workout-start')).toHaveCount(1);
    await expect(page.getByTestId('workout-continue')).toHaveCount(0);

    await page.unroute('**/api/v1/workout-plan/today**');
    await page.unroute('**/api/v1/workout-plan/week**');
    await page.getByTestId('workout-soft-retry').click();
    await expect(page.getByTestId('workout-soft-error')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('workout-start')).toHaveCount(1);

    await trigger.click();
    const option = page.getByTestId(/workout-change-option-/).first();
    await expect(option).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await option.click();
    await expect(page.getByTestId('workout-replacement-undo')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-today')).toBeVisible();
  });

  test('responsive 320/375/390/1280 and week overflow', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `workout-v2-01e-resp-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);
    await generatePlan(page);
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });
    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-start')).toBeVisible();

    for (const width of [320, 375, 390, 1280] as const) {
      await page.setViewportSize({ width, height: width < 768 ? 568 : 900 });
      await expect(page.getByTestId('workout-start')).toBeVisible();
      await assertOverflowZero(page);
      await page.getByTestId(/workout-change-today-/).click();
      await expect(page.getByTestId(/workout-change-today-sheet-/)).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByTestId('workout-tab-week').click();
      await expect(page.getByTestId('workout-week')).toBeVisible();
      await assertOverflowZero(page);
      await page.getByTestId('workout-tab-today').click();
    }

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
  });
});
