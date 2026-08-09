import { describe, expect, it } from 'vitest';
import { validateCsvCatalog } from '../domain/csv-catalog.validator';

describe('csv catalog validation', () => {
  const validCsv =
    'product_key,name,category,weight,price,retailer\nchicken_breast,Куриная грудка,protein,500g,299,Магнит\n';

  it('accepts valid catalog CSV', () => {
    const result = validateCsvCatalog(validCsv);
    expect(result.valid).toBe(true);
    expect(result.validRowCount).toBe(1);
    expect(result.rows[0]?.productKey).toBe('chicken_breast');
  });

  it('reports missing required columns', () => {
    const result = validateCsvCatalog('name,price\nTest,100\n');
    expect(result.valid).toBe(false);
    expect(result.missingColumns).toContain('product_key');
    expect(result.missingColumns).toContain('retailer');
  });

  it('reports per-row validation errors without failing entire file', () => {
    const result = validateCsvCatalog(
      'product_key,name,category,price,retailer\nok_product,OK,protein,100,Store\n,bad,,not-a-number,Store\n',
    );
    expect(result.valid).toBe(false);
    expect(result.validRowCount).toBe(1);
    expect(result.errors.some((e) => e.line === 3)).toBe(true);
    expect(result.errors.some((e) => e.field === 'product_key')).toBe(true);
  });

  it('rejects empty file', () => {
    const result = validateCsvCatalog('product_key,name,price,retailer\n');
    expect(result.valid).toBe(false);
    expect(result.rowCount).toBe(0);
  });
});
