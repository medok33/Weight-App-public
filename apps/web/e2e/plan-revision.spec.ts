import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const password = 'Password12345';

async function registerAndOnboard(page: Page, email: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/onboarding');
  await page.getByTestId('profile-name').fill('Revision Browser');
  await page.getByTestId('profile-age').fill('31');
  await page.getByTestId('profile-height').fill('178');
  await page.getByTestId('profile-weight').fill('82');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('76');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText(/сохран|saved/i);
}

function parseVersion(text: string | null): number {
  const match = String(text ?? '').match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

test.describe('STEP_100 plan revision browser acceptance', () => {
  test('meal plan: preview cancel confirm reload re-login', async ({ page }) => {
    const email = `rev-meal-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('revision-open')).toBeVisible();

    const versionBefore = parseVersion(await page.getByTestId('meal-plan-version').textContent());
    expect(versionBefore).toBeGreaterThan(0);

    // empty reason validation
    await page.getByTestId('revision-open').click();
    await page.getByTestId('revision-preview').click();
    await expect(page.getByTestId('revision-message')).toContainText(/причин/i);

    // preview
    await page.getByTestId('revision-reason').fill('travel');
    await page.getByTestId('revision-preview').click();
    await expect(page.getByTestId('revision-preview-result')).toBeVisible();
    await expect(page.getByTestId('revision-change-item').first()).toBeVisible();
    await page.screenshot({ path: resolve(screenshotsDir, '110-revision-preview.png'), fullPage: true });

    // preview must not change active version
    await expect(page.getByTestId('meal-plan-version')).toContainText(String(versionBefore));

    // cancel
    await page.getByTestId('revision-discard').click();
    await expect(page.getByTestId('revision-open')).toBeVisible();
    await expect(page.getByTestId('meal-plan-version')).toContainText(String(versionBefore));

    // preview again + confirm (double-click guarded by confirming flag + same Idempotency-Key)
    await page.getByTestId('revision-open').click();
    await page.getByTestId('revision-reason').fill('travel');
    await page.getByTestId('revision-preview').click();
    await expect(page.getByTestId('revision-preview-result')).toBeVisible();

    const confirmButton = page.getByTestId('revision-confirm');
    await confirmButton.click();
    await confirmButton.click({ force: true }).catch(() => undefined);
    await expect(page.getByTestId('revision-message')).toContainText(/обновл|updated|применено|applied/i);

    const versionAfterConfirm = parseVersion(await page.getByTestId('meal-plan-version').textContent());
    expect(versionAfterConfirm).toBeGreaterThan(versionBefore);
    await expect(page.getByTestId('meal-day-0')).toBeVisible();
    await page.screenshot({ path: resolve(screenshotsDir, '111-revision-confirmed.png'), fullPage: true });

    // reload persistence
    await page.reload();
    await expect(page.getByTestId('meal-heading')).toBeVisible({ timeout: 15000 });
    const versionAfterReload = parseVersion(await page.getByTestId('meal-plan-version').textContent());
    expect(versionAfterReload).toBe(versionAfterConfirm);
    await page.screenshot({ path: resolve(screenshotsDir, '112-revision-reload.png'), fullPage: true });

    // logout / login
    await page.getByTestId('auth-logout').click();
    await page.waitForURL('**/login**', { timeout: 15000 });
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    // Post-login may restore last route (e.g. meal-plan) instead of dashboard.
    await page.waitForURL(
      (url) => !url.pathname.includes('/login') && !url.pathname.includes('/register'),
      { timeout: 30000 },
    );

    await page.goto('/meal-plan');
    await expect(page.getByTestId('meal-plan-version')).toContainText(String(versionAfterConfirm));

    // API unavailable message
    await page.getByTestId('revision-open').click();
    await page.getByTestId('revision-reason').fill('holiday');
    await page.route('**/plans/*/revisions/preview', (route) => route.abort());
    await page.getByTestId('revision-preview').click();
    await expect(page.getByTestId('revision-message')).toContainText(/API недоступен|не удалось/i);
    await page.unroute('**/plans/*/revisions/preview');

    // invalid token via API
    const meal = await page.request.get(`${api}/meal-plan`);
    expect(meal.ok()).toBeTruthy();
    const mealJson = (await meal.json()) as { planId?: string; version: number };
    expect(mealJson.planId).toBeTruthy();
    const bad = await page.request.post(`${api}/plans/${mealJson.planId}/revisions/confirm`, {
      headers: { 'Idempotency-Key': `bad-token-${Date.now()}` },
      data: { planKind: 'meal', confirmationToken: 'not.a.valid.token' },
    });
    expect(bad.status()).toBe(400);

    // stale preview: preview → regenerate → confirm old token
    const sourcePlanId = mealJson.planId!;
    const preview = await page.request.post(`${api}/plans/${sourcePlanId}/revisions/preview`, {
      data: { planKind: 'meal', reason: 'shift' },
    });
    expect(preview.ok()).toBeTruthy();
    const previewJson = (await preview.json()) as { confirmationToken: string };
    const regenerated = await page.request.post(`${api}/meal-plan/regenerate`);
    expect(regenerated.ok()).toBeTruthy();
    const stale = await page.request.post(`${api}/plans/${sourcePlanId}/revisions/confirm`, {
      headers: { 'Idempotency-Key': `stale-${Date.now()}` },
      data: { planKind: 'meal', confirmationToken: previewJson.confirmationToken },
    });
    expect(stale.status()).toBe(409);
    const staleBody = (await stale.json().catch(() => ({}))) as { message?: string };
    expect(String(staleBody.message ?? '')).toMatch(/STALE|stale|изменил/i);
  });

  test('workout plan: preview confirm reload', async ({ page }) => {
    const email = `rev-workout-${Date.now()}@test.com`;
    await registerAndOnboard(page, email);

    await page.goto('/workout-engine');
    await expect(page.getByTestId('workout-heading')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('revision-open')).toBeVisible();

    const versionBefore = parseVersion(await page.getByTestId('workout-plan-version').textContent());
    await page.getByTestId('revision-open').click();
    await page.getByTestId('revision-reason').fill('knee injury');
    await page.getByTestId('revision-preview').click();
    await expect(page.getByTestId('revision-preview-result')).toBeVisible();
    await expect(page.getByTestId('workout-plan-version')).toContainText(String(versionBefore));

    await page.getByTestId('revision-confirm').click();
    await expect(page.getByTestId('revision-message')).toContainText(/обновл|updated|применено|applied/i);
    const versionAfter = parseVersion(await page.getByTestId('workout-plan-version').textContent());
    expect(versionAfter).toBeGreaterThan(versionBefore);

    await page.reload();
    await expect(page.getByTestId('workout-plan-version')).toContainText(String(versionAfter));
  });
});
