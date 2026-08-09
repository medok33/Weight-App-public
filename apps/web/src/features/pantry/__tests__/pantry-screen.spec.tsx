import { describe, expect, it } from 'vitest';
import type { PantryItem } from '../model/pantry.types';

describe('pantry UI contract STEP_176', () => {
  it('exposes expiry statuses used by the screen', () => {
    const sample: PantryItem = {
      id: '1',
      name: 'Milk',
      quantity: 1,
      unit: 'l',
      expiresOn: '2026-07-25',
      expiryStatus: 'soon',
    };
    expect(['ok', 'soon', 'expired', 'unknown']).toContain(sample.expiryStatus);
  });
});
