import { describe, expect, it } from 'vitest';
import { selectCanonicalProduct } from '../domain/recipe-product-selection.policy';
import { resolveSynthesisDefault, SYNTHESIS_PRODUCT_POLICY_VERSION } from '../domain/recipe-synthesis-product-policy';

const catalog = [
  { productId: 'milk_2_5pct', canonicalName: 'Молоко питьевое 2.5%', fatPercent: 2.5, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'milk_3_2pct', canonicalName: 'Молоко 3.2%', fatPercent: 3.2, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'sunflower_oil', canonicalName: 'Подсолнечное масло', form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'olive_oil', canonicalName: 'Оливковое масло', form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'wheat_flour', canonicalName: 'Мука пшеничная', form: 'DRY', nutritionVersionPresent: true },
  { productId: 'rye_flour', canonicalName: 'Мука ржаная', form: 'DRY', nutritionVersionPresent: true },
  { productId: 'sour_cream_15pct', canonicalName: 'Сметана 15%', fatPercent: 15, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'sour_cream_20pct', canonicalName: 'Сметана 20%', fatPercent: 20, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'kefir_2_5pct', canonicalName: 'Кефир 2.5%', fatPercent: 2.5, form: 'READY_TO_EAT', nutritionVersionPresent: true },
  { productId: 'kefir_1pct', canonicalName: 'Кефир 1%', fatPercent: 1, form: 'READY_TO_EAT', nutritionVersionPresent: true },
];
const generic = (name: string, family: string) => ({ name, identity: family, family, productId: `family:${family}`, allowSynthesisDefault: true, researchConflict: false });

describe('OWNER-RECIPE-DEFAULTS-DECISION-01', () => {
  it('selects exact owner milk 2.5% and keeps explicit milk fat', () => {
    expect(selectCanonicalProduct(generic('молоко', 'молоко'), catalog)).toMatchObject({ state: 'CANONICAL_FAMILY_DEFAULT_SELECTED', selectedProductId: 'milk_2_5pct' });
    expect(selectCanonicalProduct(generic('молоко 3.2%', 'молоко'), catalog)).toMatchObject({ state: 'EXPLICIT_FORM_PRODUCT_SELECTED', selectedProductId: 'milk_3_2pct' });
  });
  it('selects refined sunflower only for generic vegetable oil', () => {
    expect(selectCanonicalProduct(generic('растительное масло', 'растительное масло'), catalog)).toMatchObject({ state: 'CANONICAL_FAMILY_DEFAULT_SELECTED', selectedProductId: 'sunflower_oil' });
    expect(selectCanonicalProduct(generic('оливковое масло', 'растительное масло'), catalog).selectedProductId).not.toBe('sunflower_oil');
  });
  it('selects wheat flour only for generic flour', () => {
    expect(selectCanonicalProduct(generic('мука', 'мука'), catalog)).toMatchObject({ state: 'CANONICAL_FAMILY_DEFAULT_SELECTED', selectedProductId: 'wheat_flour' });
    expect(selectCanonicalProduct(generic('мука ржаная', 'мука'), catalog).selectedProductId).not.toBe('wheat_flour');
  });
  it('selects exact sour cream and kefir owner variants', () => {
    expect(selectCanonicalProduct(generic('сметана', 'сметана'), catalog)).toMatchObject({ state: 'CANONICAL_FAMILY_DEFAULT_SELECTED', selectedProductId: 'sour_cream_15pct' });
    expect(selectCanonicalProduct(generic('сметана 20%', 'сметана'), catalog)).toMatchObject({ state: 'EXPLICIT_FORM_PRODUCT_SELECTED', selectedProductId: 'sour_cream_20pct' });
    expect(selectCanonicalProduct(generic('кефир', 'кефир'), catalog)).toMatchObject({ state: 'CANONICAL_FAMILY_DEFAULT_SELECTED', selectedProductId: 'kefir_2_5pct' });
    expect(selectCanonicalProduct(generic('кефир 1%', 'кефир'), catalog)).toMatchObject({ state: 'EXPLICIT_FORM_PRODUCT_SELECTED', selectedProductId: 'kefir_1pct' });
  });
  it('fails closed for missing exact owner product and research conflict', () => {
    expect(resolveSynthesisDefault({ sourceIdentity: 'молоко', sourceName: 'молоко', explicitQualifiers: [], candidateProductIds: ['milk_3_2pct'], nutritionVersionProductIds: ['milk_3_2pct'], researchConflict: false }).applied).toBe(false);
    expect(resolveSynthesisDefault({ sourceIdentity: 'молоко', sourceName: 'молоко', explicitQualifiers: [], candidateProductIds: ['milk_2_5pct'], nutritionVersionProductIds: ['milk_2_5pct'], researchConflict: true }).policyClass).toBe('RESEARCH_CONFLICT');
  });
  it('keeps provenance and v2 deterministic', () => {
    const result = resolveSynthesisDefault({ sourceIdentity: 'кефир', sourceName: 'кефир', explicitQualifiers: [], candidateProductIds: ['kefir_2_5pct'], nutritionVersionProductIds: ['kefir_2_5pct'], researchConflict: false });
    expect(result).toMatchObject({ applied: true, defaultProductId: 'kefir_2_5pct', selectionAuthority: 'WEIGHT_APP_SYNTHESIS_POLICY', sourceInterpretationChanged: 'NO', policyVersion: SYNTHESIS_PRODUCT_POLICY_VERSION });
  });
});
