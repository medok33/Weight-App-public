import { Inject, Injectable } from '@nestjs/common';
import {
  assertPantryOwner,
  explainPantryUsage,
  selectPantryFirstCandidates,
  validatePantryItemInput,
  withExpiryStatus,
} from '../domain/pantry.policy';
import type { PantryMealCandidate, PantryItemView, PantryRecord } from '../domain/pantry.types';
import { PantryRepository } from '../infrastructure/pantry.repository';
import { ingredientsForMealName } from '../../shopping-list/domain/shopping-list.catalog';

@Injectable()
export class PantryService {
  constructor(@Inject(PantryRepository) private readonly repository: PantryRepository) {}

  async getOrCreate(userId: string): Promise<PantryRecord> {
    if (!userId?.trim()) throw new Error('PANTRY_USER_INVALID');
    const existing = await this.repository.findByUser(userId);
    if (existing) return existing;
    return this.repository.createForUser(userId);
  }

  async inventory(userId: string, today = new Date().toISOString().slice(0, 10)): Promise<{
    pantry: PantryRecord;
    items: PantryItemView[];
  }> {
    const pantry = await this.getOrCreate(userId);
    assertPantryOwner(pantry.userId, userId);
    const items = withExpiryStatus(await this.repository.listItems(pantry.id), today);
    return { pantry, items };
  }

  async upsertItem(
    userId: string,
    raw: { name?: string; quantity?: number; unit?: string; expiresOn?: string | null },
    today = new Date().toISOString().slice(0, 10),
  ) {
    const pantry = await this.getOrCreate(userId);
    assertPantryOwner(pantry.userId, userId);
    const input = validatePantryItemInput(raw);
    const saved = await this.repository.upsertItem(pantry.id, input);
    const items = withExpiryStatus(await this.repository.listItems(pantry.id), today);
    return { item: withExpiryStatus([saved], today)[0], items };
  }

  async removeItem(userId: string, itemId: string, today = new Date().toISOString().slice(0, 10)) {
    const pantry = await this.getOrCreate(userId);
    assertPantryOwner(pantry.userId, userId);
    const ok = await this.repository.deleteItem(pantry.id, itemId);
    if (!ok) throw new Error('PANTRY_ITEM_NOT_FOUND');
    return this.inventory(userId, today);
  }

  async weightCandidates(
    userId: string,
    candidates: PantryMealCandidate[],
    excludedTags: string[] = [],
    today = new Date().toISOString().slice(0, 10),
  ) {
    const { items } = await this.inventory(userId, today);
    return selectPantryFirstCandidates(candidates, excludedTags, items, today, ingredientsForMealName);
  }

  async explainPlanIngredients(userId: string, mealNames: string[], today = new Date().toISOString().slice(0, 10)) {
    const { items } = await this.inventory(userId, today);
    return explainPantryUsage(mealNames, items, today, ingredientsForMealName);
  }
}
