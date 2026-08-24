import { describe, expect, it } from 'vitest';
import { runDesignChoiceAudit } from '../../../../scripts/recipe-synthesis-design-choice-policy-01';
import { resolveSynthesisDefault } from '../domain/recipe-synthesis-product-policy';

describe('RECIPE-SYNTHESIS-DESIGN-CHOICE-POLICY-01', () => {
  it('reproduces the accepted 11-cluster baseline and audits all 42 pending rows', async () => {
    const { result, audited } = await runDesignChoiceAudit();
    expect(result.metrics.COHORT_CLUSTERS_ANALYZED).toBe(11);
    expect(result.metrics.TOTAL_REQUIRED_INGREDIENTS).toBe(264);
    expect(result.metrics.PRODUCT_CATALOG_GAP).toBe(24);
    expect(result.metrics.PRODUCT_SELECTION_PENDING).toBe(40);
    expect(result.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER).toBe(1);
    expect(audited).toHaveLength(40);
  }, 180_000);

  it('keeps the conservative classification partition fail-closed', async () => {
    const { audited } = await runDesignChoiceAudit();
    const counts = new Map<string, number>();
    for (const row of audited) counts.set(row.policyClass, (counts.get(row.policyClass) ?? 0) + 1);
    expect(counts.get('SAFE_SYNTHESIS_DESIGN_CHOICE') ?? 0).toBe(0);
    expect(counts.get('OWNER_DESIGN_POLICY_REQUIRED')).toBe(12);
    expect(counts.get('RESEARCH_CONFLICT')).toBe(27);
    expect(counts.get('PARSER_OR_IDENTITY_REMEDIATION')).toBe(1);
    expect([...counts.values()].reduce((sum, value) => sum + value, 0)).toBe(40);
  }, 180_000);

  it('preserves explicit source qualifiers and owner-default priority', () => {
    const explicit = resolveSynthesisDefault({ sourceIdentity: 'молоко', sourceName: 'молоко 3.2%', explicitQualifiers: ['3.2%'], candidateProductIds: ['milk_3_2pct', 'milk_2_5pct'], nutritionVersionProductIds: ['milk_3_2pct', 'milk_2_5pct'], researchConflict: false });
    expect(explicit.applied).toBe(false);
    const owner = resolveSynthesisDefault({ sourceIdentity: 'молоко', sourceName: 'молоко', explicitQualifiers: [], candidateProductIds: ['milk_2_5pct'], nutritionVersionProductIds: ['milk_2_5pct'], researchConflict: false });
    expect(owner.applied).toBe(true);
    expect(owner.defaultProductId).toBe('milk_2_5pct');
  });

  it('does not cross food identity, optimize nutrition, or use price', () => {
    const meat = resolveSynthesisDefault({ sourceIdentity: 'фарш', sourceName: 'фарш', explicitQualifiers: [], candidateProductIds: ['beef_mince_raw', 'chicken_mince_raw', 'pork_mince_raw'], nutritionVersionProductIds: ['beef_mince_raw', 'chicken_mince_raw', 'pork_mince_raw'], researchConflict: false });
    expect(meat.applied).toBe(false);
    expect(meat.policyClass).toBe('NO_SAFE_DEFAULT');
  });

  it('does not activate policy rows, create products, or claim grams readiness', async () => {
    const { result, audited } = await runDesignChoiceAudit();
    expect(audited.filter((row) => row.selectedProductId !== null)).toHaveLength(0);
    expect(result.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER).toBe(1);
  }, 180_000);
});
