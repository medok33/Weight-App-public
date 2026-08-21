import { describe, expect, it } from 'vitest';
import {
  resolveSynthesisDefault,
  SYNTHESIS_PRODUCT_POLICY,
  SYNTHESIS_PRODUCT_POLICY_VERSION,
} from '../domain/recipe-synthesis-product-policy';

const input = (overrides: Partial<Parameters<typeof resolveSynthesisDefault>[0]> = {}) => ({
  sourceIdentity: 'соль', sourceName: 'Соль', explicitQualifiers: [], candidateProductIds: ['salt_table'], nutritionVersionProductIds: ['salt_table'], researchConflict: false, ...overrides,
});

describe('recipe synthesis product default policy', () => {
  it('applies only the versioned same-identity salt default', () => {
    const result = resolveSynthesisDefault(input());
    expect(result.applied).toBe(true);
    expect(result.defaultProductId).toBe('salt_table');
    expect(result.selectionAuthority).toBe('WEIGHT_APP_SYNTHESIS_POLICY');
    expect(result.sourceInterpretationChanged).toBe('NO');
    expect(result.policyVersion).toBe(SYNTHESIS_PRODUCT_POLICY_VERSION);
  });

  it('does not rewrite generic source evidence or override explicit form evidence', () => {
    const result = resolveSynthesisDefault(input({ explicitQualifiers: ['2.5%'] }));
    expect(result.applied).toBe(false);
    expect(result.selectionAuthority).toBe('NONE');
    expect(result.sourceInterpretationChanged).toBe('NO');
  });

  it('fails closed without the policy product, nutrition authority or on research conflict', () => {
    expect(resolveSynthesisDefault(input({ candidateProductIds: ['salt_table_other'] })).applied).toBe(false);
    expect(resolveSynthesisDefault(input({ nutritionVersionProductIds: [] })).applied).toBe(false);
    expect(resolveSynthesisDefault(input({ researchConflict: true })).policyClass).toBe('RESEARCH_CONFLICT');
  });

  it('does not select incompatible food identities or price-based variants', () => {
    expect(resolveSynthesisDefault(input({ sourceIdentity: 'масло', sourceName: 'масло' })).applied).toBe(false);
    expect(resolveSynthesisDefault(input({ sourceIdentity: 'растительное масло', sourceName: 'растительное масло' })).policyClass).toBe('OWNER_POLICY_REQUIRED');
    expect(SYNTHESIS_PRODUCT_POLICY.some((entry) => entry.defaultProductId === 'salt_table' && entry.reason.includes('price'))).toBe(false);
  });

  it('keeps policy definitions deterministic and unique', () => {
    const families = SYNTHESIS_PRODUCT_POLICY.map((entry) => entry.familyId);
    expect(new Set(families).size).toBe(families.length);
    expect(SYNTHESIS_PRODUCT_POLICY.every((entry) => entry.policyVersion === SYNTHESIS_PRODUCT_POLICY_VERSION)).toBe(true);
  });
});
