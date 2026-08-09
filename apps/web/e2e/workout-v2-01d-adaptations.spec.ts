import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

const password = 'WorkoutV201dFix1Pass1!';
const fatal: string[] = [];
const VIEWPORTS = [360, 390, 430, 768, 1280] as const;

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

async function saveProfileForToday(page: Page) {
  const today = todayDayIndex();
  const extras = [0, 2, 4].filter((day) => day !== today).slice(0, 2);
  const selected = new Set([today, ...extras]);

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

async function assertNoHorizontalOverflow(page: Page, width: number) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('workout-adaptation-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить' }).first()).toBeVisible();
}

test.describe('WORKOUT-V2-01D adaptations', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('preview apply undo + viewports + ru labels', async ({ page }) => {
    test.setTimeout(300_000);
    const email = `workout-v2-01d-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.goto('/workout-engine?tab=plan');
    await expect(page.getByTestId('workout-my-plan')).toBeVisible({ timeout: 30_000 });
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-today')).toBeVisible();

    const changeToday = page.getByTestId(/workout-change-today-/).first();
    await expect(changeToday).toBeVisible({ timeout: 30_000 });
    await changeToday.click();
    const adaptButton = page.getByTestId(/workout-adapt-/).first();
    await expect(adaptButton).toBeVisible({ timeout: 30_000 });
    await expect(adaptButton).toContainText(/Подстроить под дом|Adjust for home/i);
    await adaptButton.click();

    const panel = page.getByTestId('workout-adaptation-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('button', { name: 'Провести дома' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Сделать короче' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Сделать легче' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Прогулка или восстановление' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Перенести на другой день' })).toBeVisible();

    // Internal enum codes must not appear as visible UI labels.
    await expect(panel).not.toContainText('WALK_RECOVERY');
    await expect(panel).not.toContainText('GOAL_PRESERVED');
    await expect(panel).not.toContainText('HOME_SAFE_MIN_EQUIP');

    const recommend = panel.locator('small', { hasText: 'Рекомендуем' }).first();
    await expect(recommend).toBeVisible();

    await panel.getByRole('button', { name: 'Применить' }).first().click();
    await expect(page.getByTestId('workout-live')).toContainText(/применено/i, { timeout: 30_000 });
    await expect(page.getByTestId('workout-adaptation-undo')).toBeVisible();

    await page.getByTestId('workout-adaptation-undo').click();
    await expect(page.getByTestId('workout-live')).toContainText(/отменено/i, { timeout: 30_000 });

    // Re-open for viewport matrix (active session → Change today → adapt)
    await page.getByTestId(/workout-change-today-/).first().click();
    await page.getByTestId(/workout-adapt-/).first().click();
    await expect(panel).toBeVisible({ timeout: 30_000 });
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 800 });
      await assertNoHorizontalOverflow(page, width);
    }

    const accessibility = await new AxeBuilder({ page }).include('[data-testid="workout-adaptation-panel"]').analyze();
    expect(accessibility.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
