import type { NutritionSummary } from '../model/nutrition-engine.types';
export async function getNutritionSummary(): Promise<NutritionSummary> { const response = await fetch('/api/v1/nutrition/summary'); if (!response.ok) throw new Error('NUTRITION_REQUEST_FAILED'); return response.json() as Promise<NutritionSummary>; }
