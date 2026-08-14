import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog } from './magnit-live-collector.mjs';

test('normalizes product id, RUB prices, promo and unit from public markdown', () => {
  const html = '120.00 ₽ -20% 150.00 ₽ Sample milk 1л](http://magnit.ru/product/123456-sample?shopCode=992301&shopType=dostavka "Sample milk 1л")';
  const [row] = parseCatalog(html, '2026-08-14T00:00:00.000Z');
  assert.equal(row.productId, '123456');
  assert.equal(row.promoPrice, 120);
  assert.equal(row.regularPrice, 150);
  assert.equal(row.currency, 'RUB');
  assert.equal(row.unit, '1л');
});

test('does not fabricate rows without a currency price', () => {
  assert.deepEqual(parseCatalog('Sample](http://magnit.ru/product/1-sample "Sample")', new Date().toISOString()), []);
});
