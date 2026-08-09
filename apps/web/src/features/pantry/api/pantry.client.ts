import { apiFetch } from '@/lib/api-fetch';
import type { PantryInventory, PantryItem } from '../model/pantry.types';

export async function getPantryInventory(): Promise<PantryInventory> {
  const response = await apiFetch('/pantry');
  if (response.status === 403) throw new Error('PANTRY_FORBIDDEN');
  if (!response.ok) throw new Error('PANTRY_REQUEST_FAILED');
  return response.json() as Promise<PantryInventory>;
}

export async function upsertPantryItem(input: {
  name: string;
  quantity: number;
  unit: string;
  expiresOn?: string | null;
}): Promise<{ item: PantryItem; items: PantryItem[] }> {
  const response = await apiFetch('/pantry/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (response.status === 403) throw new Error('PANTRY_FORBIDDEN');
  if (!response.ok) throw new Error('PANTRY_SAVE_FAILED');
  return response.json() as Promise<{ item: PantryItem; items: PantryItem[] }>;
}
