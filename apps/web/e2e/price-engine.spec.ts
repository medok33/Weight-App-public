import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotsDir = resolve(process.cwd(), 'e2e/artifacts');
mkdirSync(screenshotsDir, { recursive: true });
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

test('price engine: catalog CSV → shopping shows store+source → dashboard cost', async ({ page, request }) => {
  const stamp = Date.now();

  const catalog = await request.post(`${api}/price-intelligence/sources/catalog-csv`, {
    data: {
      sourceName: 'Импорт CSV',
      retailerCode: 'MAGNIT',
      payload:
        'product_key,name,category,weight,price,retailer,retailer_code\nchicken_breast,Куриная грудка,protein,500g,299,Магнит,MAGNIT\toats,Овсянка,grains,500g,95,Магнит,MAGNIT\nrice,Рис,grains,900g,110,Магнит,MAGNIT\n',
    },
  });
  expect(catalog.ok()).toBeTruthy();
  const body = await catalog.json();
  expect(body.sourceType).toBe('CSV');
  expect(body.imported).toBeGreaterThan(0);

  await page.goto('/onboarding');
  await page.getByTestId('profile-name').fill(`Engine ${stamp}`);
  await page.getByTestId('profile-age').fill('32');
  await page.getByTestId('profile-height').fill('176');
  await page.getByTestId('profile-weight').fill('81');
  await page.getByTestId('profile-goal-kind').selectOption('lose_weight');
  await page.getByTestId('profile-goal-target').fill('74');
  await page.getByTestId('profile-activity').selectOption('moderate');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-status')).toContainText('Профиль сохранён', { timeout: 20000 });

  await page.goto('/shopping-list');
  await page.getByTestId('shopping-generate').click();
  await expect(page.getByTestId('shopping-items')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid^="shopping-item-source-"]').first()).toBeVisible();
  const sources = await page.locator('[data-testid^="shopping-item-source-"]').allTextContents();
  expect(sources.some((text) => /Источник:/i.test(text))).toBeTruthy();
  await page.screenshot({ path: resolve(screenshotsDir, '60-price-engine-shopping.png'), fullPage: true });

  await page.goto('/dashboard-today');
  await expect(page.getByTestId('budget-week')).toBeVisible({ timeout: 15000 });
  const week = await page.getByTestId('budget-week').innerText();
  expect(week).not.toMatch(/Стоимость недели: 0\b/);
  await page.screenshot({ path: resolve(screenshotsDir, '61-price-engine-dashboard.png'), fullPage: true });
});
