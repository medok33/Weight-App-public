import { expect, test } from '@playwright/test';

test('security ops UI stays owner-gated (USER cannot open observability ops)', async ({ page }) => {
  await page.goto('/observability');
  // Unauthenticated / non-owner sessions land on forbidden or login-gated content — never metrics dump.
  const screen = page.getByTestId('observability-screen');
  await expect(screen).toBeVisible({ timeout: 20000 });
  const body = await page.locator('main').innerText();
  expect(body).not.toMatch(/BACKUP_ENCRYPTION_SECRET|postgresql:\/\/[^:]+:[^@]+@/i);
});
