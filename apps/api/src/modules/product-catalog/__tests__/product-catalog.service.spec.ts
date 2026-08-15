import { strict as assert } from 'node:assert'; import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; import { test } from 'node:test'; import { ProductCatalogService } from '../application/product-catalog.service';
test('product aliases resolve canonically', () => { const service = new ProductCatalogService(); service.register({ canonicalName: 'Oats', unit: 'g', caloriesPer100g: 380, proteinPer100g: 13, aliases: [' ОВСЯНКА '] }); assert.equal(service.resolveAlias('овсянка')?.canonicalName, 'Oats'); });
test('invalid product is rejected', () => assert.throws(() => new ProductCatalogService().register({ canonicalName: '', unit: 'g', caloriesPer100g: 0, proteinPer100g: 0 }), /PRODUCT_INVALID/));
test('product price resolver has no raw PriceObservation selection bypass', () => {
  const resolverPath = fileURLToPath(new URL('../application/product-roles-retail.resolvers.ts', import.meta.url));
  const source = readFileSync(resolverPath, 'utf8');
  assert.equal(/FROM\s+"PriceObservation"/i.test(source), false);
  assert.match(source, /readReferencePriceWithQuery/);
});
