import { expect, test } from '@playwright/test';

test('observability dashboard UI smoke', async ({ page }) => {
  await page.goto('/observability');
  await expect(page.getByTestId('observability-screen')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
});
