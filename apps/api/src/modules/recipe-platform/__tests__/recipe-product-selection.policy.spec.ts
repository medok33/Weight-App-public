import { describe, expect, it } from 'vitest';
import { selectCanonicalProduct } from '../domain/recipe-product-selection.policy';

const catalog = [
  { productId: 'milk-25', canonicalName: 'Молоко 2.5%', fatPercent: 2.5, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'milk-32', canonicalName: 'Молоко 3.2%', fatPercent: 3.2, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'sour-20', canonicalName: 'Сметана 20%', fatPercent: 20, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'spinach-frozen', canonicalName: 'Шпинат замороженный', form: 'FROZEN', nutritionVersionPresent: true },
  { productId: 'tuna-canned', canonicalName: 'Тунец консервированный', form: 'CANNED', nutritionVersionPresent: true },
  { productId: 'chicken-breast', canonicalName: 'Куриная грудка', form: 'RAW', nutritionVersionPresent: true },
  { productId: 'beef-mince', canonicalName: 'Фарш говяжий', form: 'RAW', nutritionVersionPresent: true },
  { productId: 'sunflower-oil', canonicalName: 'Подсолнечное масло', form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'olive-oil', canonicalName: 'Оливковое масло', form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'flour', canonicalName: 'Мука пшеничная', form: 'DRY', nutritionVersionPresent: true },
  { productId: 'no-nutrition', canonicalName: 'Молоко специальное', form: 'READY_TO_EAT', nutritionVersionPresent: false },
];

describe('deterministic product selection policy', () => {
  it('selects explicit fat percentage only when one compatible product remains', () => expect(selectCanonicalProduct({ name: 'молоко 3.2%', identity: 'молоко', family: 'молоко', productId: 'family:молоко' }, catalog)).toMatchObject({ state: 'EXPLICIT_FORM_PRODUCT_SELECTED', selectedProductId: 'milk-32' }));
  it('does not select arbitrary fat for generic dairy', () => expect(selectCanonicalProduct({ name: 'молоко', identity: 'молоко', family: 'молоко', productId: 'family:молоко' }, catalog).state).toBe('PRODUCT_SELECTION_PENDING'));
  it('handles frozen and canned compatibility', () => { expect(selectCanonicalProduct({ name: 'шпинат замороженный', identity: 'шпинат', family: 'шпинат', productId: 'family:шпинат' }, catalog).state).toBe('EXPLICIT_FORM_PRODUCT_SELECTED'); expect(selectCanonicalProduct({ name: 'тунец консервированный', identity: 'тунец', family: 'тунец', productId: 'family:тунец' }, catalog).state).toBe('EXPLICIT_FORM_PRODUCT_SELECTED'); });
  it('selects a single compatible product and keeps multiple candidates pending', () => { expect(selectCanonicalProduct({ name: 'куриная грудка', identity: 'куриная грудка', family: 'курица', productId: 'family:курица' }, catalog).state).toBe('SINGLE_COMPATIBLE_PRODUCT_SELECTED'); expect(selectCanonicalProduct({ name: 'растительное масло', identity: 'растительное масло', family: 'растительное масло', productId: 'family:растительное масло' }, catalog).state).toBe('PRODUCT_SELECTION_PENDING'); });
  it('fails closed for missing product and missing nutrition', () => { expect(selectCanonicalProduct({ name: 'редкий продукт', identity: 'редкий продукт', family: 'редкий продукт', productId: 'family:редкий продукт' }, catalog).state).toBe('PRODUCT_CATALOG_GAP'); expect(selectCanonicalProduct({ name: 'молоко специальное', identity: 'молоко', family: 'молоко', productId: 'family:молоко' }, [catalog[10]!]).state).toBe('PRODUCT_NUTRITION_MISSING'); });
  it('does not choose arbitrary meat cut, oil type, or flour grade', () => { expect(selectCanonicalProduct({ name: 'говядина', identity: 'говядина', family: 'говядина', productId: 'family:говядина' }, catalog).state).toBe('PRODUCT_SELECTION_PENDING'); expect(selectCanonicalProduct({ name: 'мука', identity: 'мука', family: 'мука', productId: 'family:мука' }, catalog).state).toBe('SINGLE_COMPATIBLE_PRODUCT_SELECTED'); });
  it('preserves process accounting and ignores price/technique', () => { const result = selectCanonicalProduct({ name: 'соль', identity: 'соль', family: 'соль', role: 'PROCESS_INPUT' }, catalog); expect(result).toMatchObject({ state: 'PROCESS_INPUT_ACCOUNTED', priceUsed: false, postInputTechniqueRewrite: false, arbitrarySelection: false }); });
  it('keeps an exact resolver product only with nutrition authority', () => expect(selectCanonicalProduct({ name: 'куриная грудка', identity: 'куриная грудка', family: 'курица', productId: 'chicken-breast' }, catalog)).toMatchObject({ state: 'EXACT_PRODUCT_ALREADY_RESOLVED', selectedProductId: 'chicken-breast', nutritionVersionPresent: true }));
});
