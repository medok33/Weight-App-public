import { describe, expect, it } from 'vitest';
import {
  assertRateLimit,
  assertSafeStatusTransition,
  sanitizeAliasInput,
  sanitizeCreateProduct,
  sanitizeUpdateProduct,
} from '../domain/product-admin.policy';

describe('STEP_200 product-admin policy', () => {
  it('validates create payload and rejects invalid productKey', () => {
    expect(() =>
      sanitizeCreateProduct({
        canonicalName: 'Test',
        productKey: 'BAD KEY',
        categoryId: 'c1',
        form: 'RAW',
        defaultUnit: 'g',
      }),
    ).toThrow('PRODUCT_KEY_INVALID');

    const ok = sanitizeCreateProduct({
      canonicalName: '  Гречка  ',
      productKey: 'buckwheat_test',
      categoryId: 'c1',
      form: 'DRY',
      defaultUnit: 'g',
    });
    expect(ok.canonicalName).toBe('Гречка');
    expect(ok.productKey).toBe('buckwheat_test');
  });

  it('blocks mass-assignment of merge/review actor fields', () => {
    expect(() =>
      sanitizeUpdateProduct({
        rowVersion: 1,
        // @ts-expect-error intentional mass assignment probe
        mergedBy: 'x',
      }),
    ).toThrow('PRODUCT_MASS_ASSIGNMENT_FORBIDDEN');
  });

  it('normalizes alias server-side', () => {
    expect(sanitizeAliasInput('  Рис  Белый! ').normalizedAlias).toContain('рис');
  });

  it('rejects MERGED as manual status transition', () => {
    expect(() => assertSafeStatusTransition('ACTIVE', 'MERGED')).toThrow(
      'PRODUCT_STATUS_TRANSITION_INVALID',
    );
  });

  it('rate-limits dangerous ops', () => {
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) assertRateLimit(key, 5, 60_000);
    expect(() => assertRateLimit(key, 5, 60_000)).toThrow('PRODUCT_ADMIN_RATE_LIMITED');
  });
});
