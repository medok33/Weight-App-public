import { strict as assert } from 'node:assert'; import { test } from 'node:test'; import { RecipeCatalogService } from '../application/recipe-catalog.service';
test('recipe portions scale deterministically', () => { const recipe = { name: 'Porridge', servings: 2, ingredients: [{ productId: 'oats', quantity: 100, unit: 'g' as const }] }; assert.equal(new RecipeCatalogService().scale(recipe, 3).ingredients[0].quantity, 150); });
test('empty recipes are rejected', () => assert.throws(() => new RecipeCatalogService().create({ name: 'x', servings: 1, ingredients: [] }), /RECIPE_INVALID/));
