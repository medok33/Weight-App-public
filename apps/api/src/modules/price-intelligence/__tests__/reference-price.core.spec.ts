import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRESHNESS_WINDOW_MS,
  deriveUnitPrice,
  freshnessStatus,
  normalizePackage,
  observationIdentity,
} from '../domain/reference-price.core';

describe('dependable reference price core', () => {
  it('normalizes compatible package units', () => {
    expect(normalizePackage('1', 'kg')).toMatchObject({ quantity: 1000, unit: 'GRAM' });
    expect(normalizePackage('0,9', 'kg')).toMatchObject({ quantity: 900, unit: 'GRAM' });
    expect(normalizePackage('1.5', 'l')).toMatchObject({ quantity: 1500, unit: 'MILLILITER' });
    expect(normalizePackage('10', 'piece')).toMatchObject({ quantity: 10, unit: 'PIECE' });
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
  });

  it('never treats stale, conditional, or fixture evidence as current', () => {
    const now = new Date('2026-01-08T00:00:00.000Z');
    expect(freshnessStatus({ observedAt: '2026-01-07T00:00:00.000Z', now })).toBe('CURRENT');
    expect(freshnessStatus({ observedAt: new Date(now.getTime() - DEFAULT_FRESHNESS_WINDOW_MS - 1), now })).toBe('STALE');
    expect(freshnessStatus({ observedAt: now, now, condition: 'LOYALTY_ONLY' })).toBe('APPROXIMATE');
    expect(freshnessStatus({ observedAt: now, now, dataClass: 'FIXTURE' })).toBe('APPROXIMATE');
  });
});
