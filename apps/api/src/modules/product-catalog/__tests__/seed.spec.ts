import { describe, expect, it } from 'vitest';
import { productDataQualityReport } from '../seed';

describe('product seed quality report', () => {
  it('passes for catalog-core-v3', () => {
    const report = productDataQualityReport('catalog-core-v3');
    expect(report.status).toBe('pass');
    expect(report.total).toBeGreaterThanOrEqual(250);
    expect(report.total).toBeLessThanOrEqual(350);
    expect(report.invalid).toBe(0);
  });

  it('passes for catalog-core-v2', () => {
    const report = productDataQualityReport('catalog-core-v2');
    expect(report.status).toBe('pass');
  });

  it('passes for pilot-v1', () => {
    const report = productDataQualityReport('pilot-v1');
    expect(report.status).toBe('pass');
  });
});
