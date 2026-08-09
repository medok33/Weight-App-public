import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

test('price admin: validate CSV, import report, retailers and observations', async ({ page, request }) => {
  const stamp = Date.now();
  const validCsv =
    `product_key,name,category,weight,price,retailer,retailer_code\nadmin_test_${stamp},Тест товар,protein,500g,199,Магнит,MAGNIT\n`;

  const invalidCsv = 'name,price\nOnly name,100\n';

  const validation = await request.post(`${api}/price-intelligence/sources/catalog-csv/validate`, {
    data: { payload: invalidCsv },
  });
  expect(validation.ok()).toBeTruthy();
  const validationBody = await validation.json();
  expect(validationBody.valid).toBe(false);
  expect(validationBody.missingColumns).toContain('product_key');

  const validCheck = await request.post(`${api}/price-intelligence/sources/catalog-csv/validate`, {
    data: { payload: validCsv },
  });
  expect((await validCheck.json()).valid).toBe(true);

  const importRes = await request.post(`${api}/price-intelligence/sources/catalog-csv`, {
    data: { payload: validCsv, sourceName: 'Admin E2E CSV', retailerCode: 'MAGNIT' },
  });
  expect(importRes.ok()).toBeTruthy();
  const report = await importRes.json();
  expect(report.productsCreated + report.productsUpdated).toBeGreaterThan(0);
  expect(report.pricesImported).toBeGreaterThan(0);

  const retailers = await request.get(`${api}/price-intelligence/admin/retailers`);
  expect(retailers.ok()).toBeTruthy();
  const retailerItems = (await retailers.json()).items as Array<{ code: string; active: boolean }>;
  expect(retailerItems.some((r) => r.code === 'MAGNIT')).toBeTruthy();

  const observations = await request.get(`${api}/price-intelligence/admin/observations?limit=50`);
  expect(observations.ok()).toBeTruthy();
  const obsItems = (await observations.json()).items as Array<{ productKey: string; sourceType: string }>;
  expect(obsItems.some((o) => o.sourceType === 'CSV')).toBeTruthy();

  await page.goto('/price-intelligence');
  await expect(page.getByTestId('price-intel-heading')).toBeVisible();
  await page.getByTestId('price-tab-import').click();
  await expect(page.getByTestId('price-import-section')).toBeVisible();
  await page.getByTestId('price-validate-catalog').click();
  await expect(page.getByTestId('price-validation-report')).toBeVisible({ timeout: 10000 });

  await page.getByTestId('price-tab-retailers').click();
  await expect(page.getByTestId('price-retailers-section')).toBeVisible();
  await expect(page.getByTestId('retailer-row-MAGNIT')).toBeVisible({ timeout: 10000 });

  await page.getByTestId('price-tab-observations').click();
  await expect(page.getByTestId('price-observations-section')).toBeVisible();
});
