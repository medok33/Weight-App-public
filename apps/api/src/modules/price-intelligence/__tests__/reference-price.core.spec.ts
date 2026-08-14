import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRESHNESS_WINDOW_MS,
  MAX_FUTURE_CLOCK_SKEW_MS,
  deriveUnitPrice,
  freshnessStatus,
  normalizeCurrency,
  normalizePackage,
  observationIdentity,
} from '../domain/reference-price.core';

describe('dependable reference price core', () => {
  it('normalizes compatible package units', () => {
    expect(normalizePackage('1', 'kg')).toMatchObject({ quantity: 1000, unit: 'GRAM' });
    expect(normalizePackage('0,9', 'kg')).toMatchObject({ quantity: 900, unit: 'GRAM' });
    expect(normalizePackage('1.5', 'l')).toMatchObject({ quantity: 1500, unit: 'MILLILITER' });
    expect(normalizePackage('10', 'piece')).toMatchObject({ quantity: 10, unit: 'PIECE' });
    expect(normalizePackage('500g', 'g')).toMatchObject({ quantity: 500, unit: 'GRAM' });
    expect(normalizePackage('0', 'g')).toBeNull();
    expect(normalizePackage('-1', 'g')).toBeNull();
    expect(normalizePackage('5', 'unknown')).toBeNull();
  });

  it('derives comparable unit prices without mixing dimensions', () => {
    expect(deriveUnitPrice(250, { quantity: 500, unit: 'GRAM' })).toEqual({ value: 500, unit: 'RUB_PER_KG' });
    expect(deriveUnitPrice(150, { quantity: 10, unit: 'PIECE' })).toEqual({ value: 15, unit: 'RUB_PER_PIECE' });
  });

  it('creates stable identities and distinguishes changed evidence', () => {
    const base = { productId: 'p', storeId: 's', retailerId: 'r', sourceType: 'CSV', sourceName: 'x', price: 10, currency: 'RUB', observedAt: '2026-01-01T00:00:00.000Z' };
    expect(observationIdentity(base)).toBe(observationIdentity(base));
    expect(observationIdentity(base)).not.toBe(observationIdentity({ ...base, price: 11 }));
    expect(observationIdentity({ ...base, packageQuantity: 500, packageUnit: 'g' }))
      .not.toBe(observationIdentity({ ...base, packageQuantity: 1, packageUnit: 'kg' }));
    expect(observationIdentity({ ...base, conditionDescription: 'basket >= 1000' }))
      .not.toBe(observationIdentity({ ...base, conditionDescription: 'basket >= 2000' }));
    expect(observationIdentity({ ...base, storeId: 'store-a', regionId: 'region-a' }))
      .not.toBe(observationIdentity({ ...base, storeId: 'store-b', regionId: 'region-b' }));
    expect(observationIdentity({ ...base, observedAt: '2026-01-01T03:00:00+03:00', packageQuantity: 0.5, packageUnit: 'kg' }))
      .toBe(observationIdentity({ ...base, observedAt: '2026-01-01T00:00:00.000Z', packageQuantity: 500, packageUnit: 'g' }));
  });

  it('fails closed for unsupported or missing currencies', () => {
    expect(normalizeCurrency(' rub ')).toBe('RUB');
    expect(() => normalizeCurrency('USD')).toThrow('PRICE_CURRENCY_UNSUPPORTED');
    expect(() => normalizeCurrency(undefined)).toThrow('PRICE_CURRENCY_UNSUPPORTED');
    expect(() => deriveUnitPrice(10, { quantity: 100, unit: 'GRAM' }, 'USD')).toThrow('PRICE_CURRENCY_UNSUPPORTED');
  });

  it('never treats stale, conditional, or fixture evidence as current', () => {
    const now = new Date('2026-01-08T00:00:00.000Z');
    expect(freshnessStatus({ observedAt: '2026-01-07T00:00:00.000Z', now })).toBe('CURRENT');
    expect(freshnessStatus({ observedAt: new Date(now.getTime() - DEFAULT_FRESHNESS_WINDOW_MS - 1), now })).toBe('STALE');
    expect(freshnessStatus({ observedAt: new Date(now.getTime() - DEFAULT_FRESHNESS_WINDOW_MS), now })).toBe('CURRENT');
    expect(freshnessStatus({ observedAt: new Date(now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS), now })).toBe('CURRENT');
    expect(freshnessStatus({ observedAt: new Date(now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS + 1), now })).toBe('UNKNOWN');
    expect(freshnessStatus({ observedAt: now, now, condition: 'LOYALTY_ONLY' })).toBe('APPROXIMATE');
    expect(freshnessStatus({ observedAt: now, now, dataClass: 'FIXTURE' })).toBe('APPROXIMATE');
  });
});
