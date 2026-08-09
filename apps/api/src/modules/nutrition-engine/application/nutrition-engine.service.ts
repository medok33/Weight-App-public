import { calculateTdee } from '../domain/nutrition-engine.policy';
import type { NutritionProfile } from '../domain/nutrition-engine.types';
import { NutritionEngineRepository } from '../infrastructure/nutrition-engine.repository';
export class NutritionEngineService { constructor(private readonly repository = new NutritionEngineRepository()) {} calculate(userId: string, profile: NutritionProfile) { if (!userId) throw new Error('NUTRITION_USER_REQUIRED'); return this.repository.save(userId, calculateTdee(profile)); } }
