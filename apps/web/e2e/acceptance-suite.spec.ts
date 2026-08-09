import { expect, test } from '@playwright/test';

test('acceptance suite page smoke', async ({ page }) => {
  await page.goto('/provesti-end-to-end-acceptance-suite');
  await expect(page.getByTestId('acceptance-suite-screen')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Acceptance suite' })).toBeVisible();
});
