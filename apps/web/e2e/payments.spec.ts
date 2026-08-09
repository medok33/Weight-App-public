import { expect, test } from '@playwright/test';

test('STEP_138 payments success/failure UX smoke', async ({ page }) => {
  await page.goto('/payments?status=success');
  await expect(page.getByTestId('payments-result')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('payments-outcome-success')).toContainText(/succeeded/i);

  await page.goto('/payments?status=failure');
  await expect(page.getByTestId('payments-outcome-failure')).toContainText(/failed/i);
});
