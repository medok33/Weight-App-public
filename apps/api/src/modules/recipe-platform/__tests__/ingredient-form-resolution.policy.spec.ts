import { describe, expect, it } from 'vitest';
import { resolveIngredientForm, type IngredientIdentityCandidate } from '../domain/ingredient-form-resolution.policy';

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
});
