import { describe, expect, it } from 'vitest';
import { mapIngredients } from '../domain/recipe-research.policy';

describe('CODEX-RECIPE-CORPUS-IMPORT-01 offline contract', () => {
  it('maps GLM normalizedName/rawQuantity fields through the accepted mapper', () => {
    const glmIngredient = { normalizedName: 'морковь', rawName: 'Морковь', rawQuantity: '100 г', normalizedUnit: 'G' };
    const mapping = mapIngredients([{ name: glmIngredient.normalizedName, amountText: glmIngredient.rawQuantity, unitText: glmIngredient.normalizedUnit }], [{ productId: 'p-carrot', canonicalName: 'Морковь', name: 'Морковь', alias: 'морковь', normalizedAlias: 'морковь', confidence: 1 }]);
    expect(mapping.mappings[0]?.productId).toBe('p-carrot');
    expect(mapping.mappings[0]?.quantityStatus).toBe('VALID');
    expect(mapping.mappings[0]?.unitStatus).toBe('KNOWN');
  });

  it('keeps an unmapped ingredient fail-closed without creating a product', () => {
    const mapping = mapIngredients([{ name: 'неизвестный ингредиент', amountText: '1', unitText: 'шт' }], []);
    expect(mapping.mappings[0]?.productId).toBeNull();
    expect(mapping.flags.some((flag) => flag.type === 'UNKNOWN_PRODUCT')).toBe(true);
  });
});
