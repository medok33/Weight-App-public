import { describe, expect, it, vi } from 'vitest';
import {
  assertPantryOwner,
  classifyExpiry,
  validatePantryItemInput,
  withExpiryStatus,
} from '../domain/pantry.policy';
import { PantryService } from '../application/pantry.service';

describe('pantry policy', () => {
  it('validates items and classifies expiry', () => {
    expect(validatePantryItemInput({ name: 'Milk', quantity: 1, unit: 'l', expiresOn: '2026-07-25' }).name).toBe(
      'Milk',
    );
    expect(() => validatePantryItemInput({ name: '', quantity: 1, unit: 'pcs' })).toThrow('PANTRY_ITEM_INVALID');
    expect(classifyExpiry('2026-07-20', '2026-07-22')).toBe('expired');
    expect(classifyExpiry('2026-07-23', '2026-07-22')).toBe('soon');
    expect(classifyExpiry('2026-08-01', '2026-07-22')).toBe('ok');
    expect(() => assertPantryOwner('a', 'b')).toThrow('PANTRY_FORBIDDEN');
  });
});

describe('PantryService', () => {
  it('upserts item for owner pantry idempotently by name+unit', async () => {
    const pantry = {
      id: 'p1',
      userId: 'u1',
      name: 'Home',
      createdAt: 't',
      updatedAt: 't',
    };
    const items = new Map<string, {
      id: string;
      pantryId: string;
      name: string;
      quantity: number;
      unit: 'l';
      expiresOn: string | null;
      createdAt: string;
      updatedAt: string;
    }>();
    const repository = {
      findByUser: vi.fn(async () => pantry),
      createForUser: vi.fn(),
      listItems: vi.fn(async () => [...items.values()]),
      upsertItem: vi.fn(async (_pantryId: string, input: { name: string; quantity: number; unit: 'l'; expiresOn?: string | null }) => {
        const key = `${input.name}|${input.unit}`;
        const row = {
          id: items.get(key)?.id ?? 'i1',
          pantryId: 'p1',
          name: input.name,
          quantity: input.quantity,
          unit: input.unit,
          expiresOn: input.expiresOn ?? null,
          createdAt: 't',
          updatedAt: 't',
        };
        items.set(key, row);
        return row;
      }),
      deleteItem: vi.fn(),
    };
    const service = new PantryService(repository as never);
    const first = await service.upsertItem('u1', { name: 'Milk', quantity: 1, unit: 'l', expiresOn: '2026-07-25' }, '2026-07-22');
    expect(first.item.expiryStatus).toBe('soon');
    const second = await service.upsertItem('u1', { name: 'Milk', quantity: 2, unit: 'l', expiresOn: '2026-07-25' }, '2026-07-22');
    expect(second.item.quantity).toBe(2);
    expect(withExpiryStatus([second.item], '2026-07-22')[0].expiryStatus).toBe('soon');
  });
});
