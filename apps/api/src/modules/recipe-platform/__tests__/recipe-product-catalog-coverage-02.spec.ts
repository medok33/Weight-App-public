import { describe, expect, it } from 'vitest';
import { runProductSelection } from '../../../../scripts/recipe-product-selection-01';

describe('RECIPE-PRODUCT-CATALOG-COVERAGE-02', () => {
  it('keeps the accepted cohort shape and reduces only safe catalog gaps', async () => {
    const result = await runProductSelection({ applySynthesisDefaults: true });
    expect(result.clusters).toHaveLength(11);
    expect(result.rows).toHaveLength(263);
    expect(result.metrics.PRODUCT_SELECTION_PENDING).toBe(41);
    expect(result.metrics.PRODUCT_CATALOG_GAP).toBeLessThan(44);
    expect(result.metrics.READY_FOR_DETERMINISTIC_GRAMS_AFTER).toBe(3);
  }, 180_000);

  it('preserves generic pending and research conflicts fail-closed', async () => {
    const result = await runProductSelection({ applySynthesisDefaults: true });
    expect(result.metrics.BLOCKED_RESEARCH_CONFLICT_CLUSTERS).toBe(3);
    expect(result.rows.filter((row) => row.state === 'PRODUCT_SELECTION_PENDING').length).toBe(41);
    expect(result.rows.some((row) => /Тушенка/.test(row.requiredIngredient) && row.selectedProductId === 'tushenka_beef_canned')).toBe(true);
  }, 180_000);

  it('does not select a generic family merely because an alias was added', async () => {
    const result = await runProductSelection({ applySynthesisDefaults: true });
    const saltRows = result.rows.filter((row) => row.requiredIngredient === 'Соль');
    expect(saltRows.some((row) => row.state === 'PRODUCT_SELECTION_PENDING')).toBe(true);
    expect(saltRows.every((row) => row.selectedProductId === null || row.selectedProductId === 'salt_table')).toBe(true);
    expect(result.rows.filter((row) => row.requiredIngredient === 'Манка').every((row) => row.selectedProductId === 'semolina_dry')).toBe(true);
  }, 180_000);
});
