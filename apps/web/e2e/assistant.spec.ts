import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const password = 'Password12345';

test('AI assistant: greeting + quinoa follow-up quality', async ({ page }) => {
  const email = `assistant-q-${Date.now()}@test.com`;

  await page.goto('/register');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard-today**', { timeout: 30000 });

  await page.goto('/assistant');
  await expect(page.getByTestId('assistant-heading')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('assistant-usage')).toBeVisible({ timeout: 15000 });

  await page.setViewportSize({ width: 1440, height: 900 });

  // GREETING — short reply, no full ration analysis
  await page.getByTestId('assistant-input').fill('Привет');
  await page.getByTestId('assistant-send').click();
  await expect(page.locator('[data-testid^="message-assistant-"]').last()).toContainText(/Привет|Чем помочь/i, {
    timeout: 30000,
  });
  await expect(page.locator('[data-testid^="message-assistant-"]').last()).not.toContainText(/рацион на неделю|БЖУ по дням/i);

  // Seed context then quinoa follow-up
  await page.getByTestId('assistant-input').fill('Что приготовить с киноа на ужин?');
  await page.getByTestId('assistant-send').click();
  await expect(page.locator('[data-testid^="message-assistant-"]').last()).toBeVisible({ timeout: 60000 });

  await page.getByTestId('assistant-input').fill('Мне не нравится и непонятно, что такое киноа');
  await page.getByTestId('assistant-send').click();
  const last = page.locator('[data-testid^="message-assistant-"]').last();
  await expect(last).toBeVisible({ timeout: 60000 });
  await expect(last).toContainText(/киноа|quinoa|крупа/i);
  await expect(last).not.toContainText(/не консультирую|оффтоп|других темах/i);

  await page.screenshot({ path: resolve(screenshotsDir, '120-assistant-quality.png'), fullPage: true });
});
