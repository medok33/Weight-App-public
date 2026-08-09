import { apiFetch } from '@/lib/api-fetch';
import type { ShoppingList } from '../model/shopping-list.types';

export async function getShoppingList(): Promise<ShoppingList> {
  const response = await apiFetch('/shopping-list');
  if (!response.ok) throw new Error('SHOPPING_LIST_REQUEST_FAILED');
  return response.json() as Promise<ShoppingList>;
}

export async function generateShoppingList(): Promise<ShoppingList> {
  const response = await apiFetch('/shopping-list/generate', { method: 'POST', body: '{}' });
  if (!response.ok) throw new Error('SHOPPING_LIST_GENERATE_FAILED');
  return response.json() as Promise<ShoppingList>;
}

export async function setShoppingItemPurchased(itemId: string, purchased: boolean): Promise<ShoppingList> {
  const response = await apiFetch('/shopping-list/items/purchase', {
    method: 'PUT',
    body: JSON.stringify({ itemId, purchased }),
  });
  if (!response.ok) throw new Error('SHOPPING_PURCHASE_FAILED');
  return response.json() as Promise<ShoppingList>;
}
