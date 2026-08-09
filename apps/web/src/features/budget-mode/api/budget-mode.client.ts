import { apiFetch } from '@/lib/api-fetch';
import type { BudgetPreferences } from '../model/budget-mode.types';

export async function getBudgetPreferences(): Promise<BudgetPreferences> {
  const response = await apiFetch('/budget-mode');
  if (response.status === 403) throw new Error('BUDGET_MODE_FORBIDDEN');
  if (!response.ok) throw new Error('BUDGET_MODE_REQUEST_FAILED');
  return response.json() as Promise<BudgetPreferences>;
}
export async function setBudgetPreferences(input: BudgetPreferences): Promise<BudgetPreferences> {
  const response = await apiFetch('/budget-mode', { method: 'POST', body: JSON.stringify(input) });
  if (!response.ok) throw new Error('BUDGET_MODE_SAVE_FAILED');
  return response.json() as Promise<BudgetPreferences>;
}
