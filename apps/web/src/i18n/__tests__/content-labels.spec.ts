import { describe, expect, it } from 'vitest';
import { enContent } from '../content/en';
import { ruContent } from '../content/ru';
import {
  formatContentLabel,
  lookupContentLabel,
  normalizeContentToken,
  resolveContentKey,
} from '../content/types';

describe('content label resolution (RUNTIME-SMOKE-01 product class)', () => {
  it('normalizes display names and product keys consistently', () => {
    expect(normalizeContentToken('Avocado')).toBe('avocado');
    expect(normalizeContentToken('Chicken breast')).toBe('chicken_breast');
    expect(normalizeContentToken('olive-oil')).toBe('olive_oil');
    expect(normalizeContentToken('  Whole-grain pasta  ')).toBe('whole_grain_pasta');
  });

  it('resolves Avocado via alias/normalization to avocado', () => {
    expect(resolveContentKey('product', 'Avocado')).toBe('avocado');
    expect(resolveContentKey('product', 'avocado')).toBe('avocado');
  });

  it('localizes known products without requiring exact alias casing', () => {
    expect(formatContentLabel('product', 'Avocado', ruContent, ruContent)).toBe('Авокадо');
    expect(formatContentLabel('product', 'AVOCADO', ruContent, ruContent)).toBe('Авокадо');
    expect(formatContentLabel('product', 'chicken_breast', enContent, ruContent)).toBe('Chicken breast');
  });

  it('never returns null crash path for unknown catalog products — falls back to API name', () => {
    expect(lookupContentLabel('product', 'Totally Unknown Veggie', ruContent, ruContent)).toBeNull();
    expect(formatContentLabel('product', 'Totally Unknown Veggie', ruContent, ruContent)).toBe(
      'Totally Unknown Veggie',
    );
    expect(formatContentLabel('product', 'buckwheat', ruContent, ruContent)).toBe('buckwheat');
  });

  it('does not treat missing product translations as hard i18n failures', () => {
    // Class regression: shopping-list used to throw MISSING_I18N_CONTENT:product.Avocado
    // when dictionary lookup failed. formatContentLabel must always return a string.
    const samples = ['Avocado', 'avocadO', 'New Retail SKU 42', 'гречка', 'step093_buckwheat'];
    for (const sample of samples) {
      const label = formatContentLabel('product', sample, ruContent, ruContent);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
