import { expect, test } from '@playwright/test';

test('documents/export UI smoke', async ({ page }) => {
  await page.goto('/export-share');
  await expect(page.getByTestId('export-share-screen')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('documents-heading')).toContainText(/Документы|Export/i);
  await expect(page.getByTestId('export-doc-meal_plan_pdf')).toBeVisible();
  await expect(page.getByTestId('documents-catalog')).toBeVisible();
});
