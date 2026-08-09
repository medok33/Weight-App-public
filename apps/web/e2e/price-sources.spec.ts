import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

test('price sources: mock API → CSV → manual → shopping shows source → reload', async ({ page, request }) => {
  const stamp = Date.now();

  const mock = await request.post(`${api}/price-intelligence/sources/mock-api`, {
    data: { sourceName: 'Mock Official API' },
  });
  expect(mock.ok()).toBeTruthy();
  const mockBody = await mock.json();
  expect(mockBody.sourceType).toBe('API');
  expect(mockBody.imported).toBeGreaterThan(0);

  const csv = await request.post(`${api}/price-intelligence/sources/open-data`, {
    data: {
      format: 'csv',
      sourceName: 'Импорт Excel 21.07.2026',
      payload:
        'product_name,category,brand,weight,price,retailer_key,retailer_type,retailer,date\nОвсянка,grains,Brand,500g,95,chain_b,CHAIN,Ритейлер B,2026-07-21\n',
    },
  });
  expect(csv.ok()).toBeTruthy();
  expect((await csv.json()).sourceType).toBe('CSV');

  const manual = await request.post(`${api}/price-intelligence/sources/manual`, {
    data: {
      sourceName: 'Ручной импорт 21.07.2026',
      csv: 'product_key,name,price,retailer_key,retailer_type,retailer\nchicken_breast,Куриная грудка,299,chain_c,DISCOUNTER,Ритейлер C\n',
    },
  });
  expect(manual.ok()).toBeTruthy();
  expect((await manual.json()).sourceType).toBe('MANUAL');

  await page.goto('/onboarding');
  await page.getByTestId('profile-name').fill(`Price Src ${stamp}`);
  await page.getByTestId('profile-age').fill('31');
  await page.getByTestId('profile-height').fill('178');
  await page.getByTestId('profile-weight').fill('82');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('75');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText('Профиль сохранён', { timeout: 20000 });

  await page.goto('/shopping-list');
  await page.getByTestId('shopping-generate').click();
  await expect(page.getByTestId('shopping-items')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid^="shopping-item-source-"]').first()).toBeVisible();
  const sources = await page.locator('[data-testid^="shopping-item-source-"]').allTextContents();
  expect(sources.some((text) => /Источник:/i.test(text))).toBeTruthy();
  expect(sources.some((text) => /Mock Official API|Импорт Excel|Ручной импорт|Каталог/i.test(text))).toBeTruthy();
  await page.screenshot({ path: resolve(screenshotsDir, '50-price-sources-shopping.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('[data-testid^="shopping-item-source-"]').first()).toBeVisible();
  await page.screenshot({ path: resolve(screenshotsDir, '51-price-sources-shopping-reload.png'), fullPage: true });
});
