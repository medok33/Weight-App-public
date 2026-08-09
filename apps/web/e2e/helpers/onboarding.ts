import type { Page } from '@playwright/test';

/** Minimal USER onboarding completion for regression suites. */
export async function completeOnboardingWizard(
  page: Page,
  opts: { name?: string; age?: string; height?: string; weight?: string; goalTarget?: string } = {},
) {
  const name = opts.name ?? 'E2E User';
  const age = opts.age ?? '30';
  const height = opts.height ?? '175';
  const weight = opts.weight ?? '80';
  const goalTarget = opts.goalTarget ?? '72';

  await page.getByTestId('onboarding-wizard').waitFor({ timeout: 60_000 });
  if (await page.getByTestId('onboarding-go-dashboard').isVisible().catch(() => false)) {
    await page.getByTestId('onboarding-go-dashboard').click();
    return;
  }

  await page.getByTestId('onboarding-continue').click();
  await page.getByTestId('onboarding-step-profile').waitFor();
  await page.getByTestId('onboarding-name').fill(name);
  await page.getByTestId('onboarding-age').fill(age);
  await page.getByTestId('onboarding-height').fill(height);
  await page.getByTestId('onboarding-weight').fill(weight);
  await page.getByTestId('onboarding-continue').click();

  await page.getByTestId('onboarding-step-goal').waitFor();
  await page.getByTestId('onboarding-goal-target').fill(goalTarget);
  await page.getByTestId('onboarding-continue').click();

  await page.getByTestId('onboarding-step-preferences').waitFor();
  await page.getByTestId('onboarding-skip').click();

  await page.getByTestId('onboarding-step-finish').waitFor();
  await page.getByTestId('onboarding-continue').click();
  await page.waitForURL((url) => url.pathname.includes('dashboard-today'), { timeout: 60_000 });
}

export async function registerAndCompleteOnboarding(page: Page, email: string, password: string) {
  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL((url) => url.pathname.includes('/onboarding'), { timeout: 60_000 });
  await completeOnboardingWizard(page);
}
