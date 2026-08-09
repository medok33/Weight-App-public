import { expect, test, type Page } from '@playwright/test';

const FORBIDDEN = [
  'Production Recipes',
  'Price Intelligence',
  'Sync mock API',
  'Something went wrong',
  'Access forbidden',
  'Possible duplicates',
  'Merge (destructive)',
  'Save changes',
  'Create version',
];
const RAW_ENUM = /\b(PUBLISHED|NEEDS_REVALIDATION|OWNED_UPLOAD|ACTIVE_LICENSED|UNDERFILLED)\b/;
const KEY_LEAK = /\badmin\.[a-z0-9_.]+\b/;

async function textOf(page: Page) {
  return page.locator('body').innerText();
}

async function assertRu(page: Page) {
  const text = await textOf(page);
  for (const lit of FORBIDDEN) expect(text, lit).not.toContain(lit);
  expect(text).not.toMatch(KEY_LEAK);
  expect(text).not.toMatch(RAW_ENUM);
}

test.describe('UI-RU-01 final acceptance product screens', () => {
  test('product list/review/duplicates chrome is Russian', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/admin/products');
    await page.waitForLoadState('domcontentloaded');
    await assertRu(page);
    await expect(page.locator('h1').first()).toContainText(/Продукт/i);

    await page.goto('/admin/product-review');
    await page.waitForLoadState('domcontentloaded');
    await assertRu(page);
    await expect(page.getByRole('heading', { name: /Очереди проверки продуктов/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Очереди проверки продуктов/i })).toBeVisible();

    await page.goto('/admin/product-duplicates');
    await page.waitForLoadState('domcontentloaded');
    await assertRu(page);
    await expect(page.getByRole('heading', { name: /дубликат/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /дубликат/i })).toBeVisible();

    await page.goto('/admin/recipe-duplicates');
    await page.waitForLoadState('domcontentloaded');
    await assertRu(page);

    await page.goto('/price-intelligence');
    await page.waitForLoadState('domcontentloaded');
    await assertRu(page);
    await expect(page.locator('h1').first()).toContainText(/Аналитика цен|Нет прав|Загрузка|недоступ/i);

    expect(
      consoleErrors.filter(
        (e) => !e.includes('favicon') && !e.includes('401 (Unauthorized)') && !e.includes('403 (Forbidden)'),
      ),
    ).toEqual([]);
  });
});
