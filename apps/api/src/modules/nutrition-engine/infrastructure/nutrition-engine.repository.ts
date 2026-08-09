import type { NutritionResult } from '../domain/nutrition-engine.types';
export class NutritionEngineRepository { save(userId: string, result: NutritionResult) { return { userId, result }; } }
