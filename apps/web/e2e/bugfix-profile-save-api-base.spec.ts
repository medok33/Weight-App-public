import { expect, test } from '@playwright/test';

const web = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

test.describe('BUGFIX-PROFILE-SAVE-01 onboarding profile save', () => {
  test('saves profile via same-origin /api/v1 and reloads values', async ({ page, context }) => {
    const email = `profile-save-${Date.now()}@example.com`;
    const password = 'DiagTestPass1!';

    const profilePuts: { url: string; status?: number }[] = [];
    const goalPuts: { url: string; status?: number }[] = [];
    const mealPosts: { url: string; status?: number }[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'PUT' && url.includes('/profile')) {
        profilePuts.push({ url });
      }
      if (req.method() === 'PUT' && url.includes('/goal')) {
        goalPuts.push({ url });
      }
      if (req.method() === 'POST' && url.includes('/meal-plan/regenerate')) {
        mealPosts.push({ url });
      }
    });

    page.on('response', (res) => {
      const url = res.url();
      if (res.request().method() === 'PUT' && url.includes('/profile')) {
        profilePuts.push({ url, status: res.status() });
      }
      if (res.request().method() === 'PUT' && url.includes('/goal')) {
        goalPuts.push({ url, status: res.status() });
      }
      if (res.request().method() === 'POST' && url.includes('/meal-plan/regenerate')) {
        mealPosts.push({ url, status: res.status() });
      }
    });

    await page.goto(`${web}/register`);
    await expect(page.getByTestId('auth-submit')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard-today**', { timeout: 30_000 });

    const cookies = await context.cookies(web);
    const session = cookies.find((c) => c.name === 'wa_session_local' || c.name === 'wa_session');
    expect(session).toBeTruthy();
    expect(session?.httpOnly).toBe(true);

    await page.goto(`${web}/onboarding`);
    await expect(page.getByTestId('profile-form')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('profile-name').fill('Save Fix User');
    await page.getByTestId('profile-age').fill('30');
    await page.getByTestId('profile-height').fill('175');
    await page.getByTestId('profile-weight').fill('80');
    await page.getByTestId('profile-goal-target').fill('75');
    await page.getByTestId('profile-save').click();

    await expect(page.getByTestId('profile-status')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('profile-status')).toHaveAttribute('data-status', 'success');

    const profileOk = profilePuts.some(
      (r) => r.status === 200 && /\/api\/v1\/profile(\?|$)/.test(new URL(r.url).pathname),
    );
    expect(profileOk).toBeTruthy();
    expect(profilePuts.some((r) => /:3001\/profile(\?|$)/.test(r.url))).toBeFalsy();
    expect(profilePuts.some((r) => r.url.includes('localhost:3001/profile'))).toBeFalsy();

    const goalOk = goalPuts.some(
      (r) => r.status === 200 && /\/api\/v1\/goal(\?|$)/.test(new URL(r.url).pathname),
    );
    expect(goalOk).toBeTruthy();

    const mealOk = mealPosts.some(
      (r) =>
        (r.status === 200 || r.status === 201) &&
        /\/api\/v1\/meal-plan\/regenerate(\?|$)/.test(new URL(r.url).pathname),
    );
    const mealFailedSeparately = mealPosts.some(
      (r) => r.status !== undefined && r.status >= 400,
    );
    expect(mealOk || mealFailedSeparately).toBeTruthy();
    if (mealFailedSeparately && !mealOk) {
      await expect(page.getByTestId('profile-status')).toContainText(/план питания/i);
    }

    await page.reload();
    await expect(page.getByTestId('profile-name')).toHaveValue('Save Fix User', { timeout: 30_000 });
    await expect(page.getByTestId('profile-age')).toHaveValue('30');
    await expect(page.getByTestId('profile-height')).toHaveValue('175');
    await expect(page.getByTestId('profile-weight')).toHaveValue('80');
    await expect(page.getByTestId('profile-goal-target')).toHaveValue('75');
  });
});
