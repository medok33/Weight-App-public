import { describe, expect, it } from 'vitest';
import { resolveIngredientForm, type IngredientIdentityCandidate } from '../domain/ingredient-form-resolution.policy';
import { normalizeUnit } from '../domain/recipe-research.policy';

const products: IngredientIdentityCandidate[] = [
  { productId: 'carrot-boiled', canonicalName: 'Морковь варёная', aliases: ['морковь вареная'] },
  { productId: 'milk-25', canonicalName: 'Молоко 2.5%' },
  { productId: 'milk-32', canonicalName: 'Молоко 3.2%' },
  { productId: 'curd-5', canonicalName: 'Творог 5%' },
  { productId: 'egg', canonicalName: 'Яйцо' },
  { productId: 'onion', canonicalName: 'Репчатый лук' },
  { productId: 'potato', canonicalName: 'Картофель' },
  { productId: 'tomato', canonicalName: 'Помидор' },
  { productId: 'squid', canonicalName: 'Кальмар' },
  { productId: 'dried-mint', canonicalName: 'Мята сушеная' },
  { productId: 'dairy-cream', canonicalName: 'Сливки' },
  { productId: 'lemon-juice', canonicalName: 'Лимонный сок' },
  { productId: 'chicken-breast-legacy', canonicalName: 'Куриная грудка', aliases: ['куриное филе'] },
  { productId: 'chicken_breast_raw', canonicalName: 'Куриная грудка сырая', aliases: ['филе куриной грудки', 'куриное филе'] },
  { productId: 'round-rice', canonicalName: 'Рис круглый сухой', aliases: ['рис круглый, непропаренный'] },
  { productId: 'tomato-cherry', canonicalName: 'Томаты черри' },
  { productId: 'oregano', canonicalName: 'Орегано' },
];

describe('ingredient identity / product form resolution', () => {
  it('resolves generic vegetable to family without choosing a variant', () => {
    const result = resolveIngredientForm({ name: 'морковь' }, products);
    expect(result.state).toBe('PRODUCT_FAMILY_RESOLVED');
    expect(result.productId).toBeNull();
    expect(result.candidateFamily).toBe('морковь');
    expect(result.productSelectionPending).toBe(true);
  });

  it('keeps an explicit accepted form as a concrete product', () => {
    const result = resolveIngredientForm({ name: 'молоко 2.5%' }, products);
    expect(result.state).toBe('FORM_EXPLICIT_PRODUCT');
    expect(result.productId).toBe('milk-25');
  });

  it('does not select arbitrary dairy variant for generic wording', () => {
    const result = resolveIngredientForm({ name: 'молоко' }, products);
    expect(result.state).toBe('PRODUCT_FAMILY_RESOLVED');
    expect(result.productId).toBeNull();
  });

  it('preserves alternatives and deterministic compounds', () => {
    expect(resolveIngredientForm({ name: 'кефир или йогурт' }, products).state).toBe('ALTERNATIVE_INGREDIENT_LINE');
    const compound = resolveIngredientForm({ name: 'соль, перец' }, products);
    expect(compound.state).toBe('COMPOUND_INGREDIENT_LINE');
    expect(compound.compoundParts).toEqual(['соль', 'перец']);
  });

  it('keeps process inputs explicit and rejects unsupported wording', () => {
    const salt = resolveIngredientForm({ name: 'соль, по вкусу', classification: 'PROCESS_INPUT' }, products);
    expect(salt.state).toBe('PROCESS_INPUT');
    expect(salt.accountingRequired).toBe(true);
    expect(resolveIngredientForm({ name: 'вода', classification: 'PROCESS_INPUT' }, products).accountingRequired).toBe(false);
    expect(resolveIngredientForm({ name: 'экзотический продукт' }, products).state).toBe('PRODUCT_MISSING');
  });

  it('accepts only deterministic morphology and lexical aliases', () => {
    expect(resolveIngredientForm({ name: 'лук репчатый' }, products).state).toBe('SAFE_ALIAS');
    expect(resolveIngredientForm({ name: 'картошка' }, products).productId).toBe('potato');
    expect(resolveIngredientForm({ name: 'помидоры' }, products).productId).toBe('tomato');
    expect(resolveIngredientForm({ name: 'кальмары' }, products).productId).toBe('squid');
  });

  it('does not drop meaningful form or semantic modifiers', () => {
    expect(resolveIngredientForm({ name: 'свежая мята' }, products).state).toBe('PRODUCT_MISSING');
    expect(resolveIngredientForm({ name: 'кокосовое молоко' }, products).candidateFamily).not.toBe('молоко');
    expect(resolveIngredientForm({ name: 'филе минтая' }, [{ productId: 'fillet', canonicalName: 'Филе' }], { knownFamilies: ['филе'] }).state).toBe('PRODUCT_MISSING');
    expect(resolveIngredientForm({ name: 'соус терияки' }, [], { knownFamilies: ['соус'] }).state).toBe('PRODUCT_MISSING');
    expect(resolveIngredientForm({ name: 'салат оливье' }, [], { knownFamilies: ['салат'] }).state).toBe('PRODUCT_MISSING');
  });

  it('classifies source labels and preserves derived lemon juice identity', () => {
    expect(resolveIngredientForm({ name: 'для подачи' }, products).state).toBe('SOURCE_SECTION_LABEL');
    expect(resolveIngredientForm({ name: 'для теста' }, products).state).toBe('SOURCE_SECTION_LABEL');
    const juice = resolveIngredientForm({ name: 'сок лимона' }, products);
    expect(juice.productId).toBe('lemon-juice');
    expect(juice.candidateFamily).not.toBe('лимон');
  });

  it('preserves chicken qualifier and safely chooses the accepted raw breast identity', () => {
    const result = resolveIngredientForm({ name: 'Куриное филе' }, products);
    expect(result.productId).toBe('chicken_breast_raw');
    expect(result.ingredientIdentity).toBe('куриная грудка');
    expect(resolveIngredientForm({ name: 'Филе куриной грудки' }, products).productId).toBe('chicken_breast_raw');
  });

  it('does not turn generic or non-chicken fillet into chicken', () => {
    expect(resolveIngredientForm({ name: 'филе' }, products).productId).not.toBe('chicken_breast_raw');
    expect(resolveIngredientForm({ name: 'филе минтая' }, products).productId).not.toBe('chicken_breast_raw');
    expect(resolveIngredientForm({ name: 'фарш из филе' }, products).productId).not.toBe('chicken_breast_raw');
  });

  it('supports case-insensitive aliases, safe word order, cherry tomato synonym and quantity-only tokens', () => {
    expect(resolveIngredientForm({ name: 'РИС КРУГЛЫЙ, НЕПРОПАРЕННЫЙ' }, products).productId).toBe('round-rice');
    expect(resolveIngredientForm({ name: 'сок лимона' }, products).productId).toBe('lemon-juice');
    expect(resolveIngredientForm({ name: 'помидоры черри' }, products).productId).toBe('tomato-cherry');
    expect(resolveIngredientForm({ name: 'Орегано, щепотка' }, products).productId).toBe('oregano');
  });

  it('keeps singular/plural eggs equivalent and normalizes culinary unit abbreviations', () => {
    expect(resolveIngredientForm({ name: 'Яйца' }, products).productId).toBe('egg');
    expect(resolveIngredientForm({ name: 'Яйцо' }, products).productId).toBe('egg');
    expect(normalizeUnit('стол.л.')).toEqual({ unit: 'tbsp', status: 'KNOWN' });
    expect(normalizeUnit('чайн.л.')).toEqual({ unit: 'tsp', status: 'KNOWN' });
  });

  it('keeps contradictory oil text fail-closed', () => {
    expect(resolveIngredientForm({ name: 'Масло растительное (сливочное)' }, products).productId).toBeNull();
    expect(resolveIngredientForm({ name: 'Масло растительное (сливочное)' }, products).productSelectionPending).toBe(true);
  });
});
