import { describe, expect, it, vi } from 'vitest';
import {
  allocateIndividualPortions,
  buildFamilyShoppingList,
  withinPortionTolerance,
} from '../domain/family-meals.policy';
import { FamilyModeService } from '../application/family-mode.service';

const dish = {
  familyId: 'f1',
  name: 'oatmeal_bowl',
  baseServings: 1,
  tags: ['dairy'],
  ingredients: [
    { productKey: 'oats', name: 'oats', category: 'grains', quantity: 60, unit: 'g', packageSize: 500, fallbackUnitPrice: 95 },
    { productKey: 'milk', name: 'milk', category: 'dairy', quantity: 200, unit: 'ml', packageSize: 1000, fallbackUnitPrice: 85 },
  ],
  nutrition: { calories: 320, proteinG: 12, fatG: 6, carbsG: 48 },
  memberPlans: [
    { userId: 'u1', portionFactor: 1 },
    { userId: 'u2', portionFactor: 1.5, allergens: ['dairy'] },
  ],
};

describe('shared dish portions STEP_182', () => {
  it('allocates rounded individual portions and flags allergen conflicts', () => {
    const result = allocateIndividualPortions(dish);
    expect(result.portions[0]).toMatchObject({ userId: 'u1', compatible: true, servings: 1, calories: 320 });
    expect(result.portions[1]).toMatchObject({
      userId: 'u2',
      compatible: false,
      suggestion: 'separate_portion',
    });
    expect(result.ingredientQuantityMatches).toBe(true);
    expect(withinPortionTolerance(1.5, 1.5)).toBe(true);
  });

  it('never returns other members macros from planSharedDish', async () => {
    const repository = { member: vi.fn().mockResolvedValue({ id: 'm1', role: 'MEMBER', status: 'ACTIVE', healthShareConsent: false }) };
    const service = new FamilyModeService(repository as never, { appendEvent: vi.fn() } as never);
    const planned = await service.planSharedDish('u1', 'f1', dish);
    expect(planned.portions).toHaveLength(1);
    expect(planned.portions[0].userId).toBe('u1');
    expect(JSON.stringify(planned)).not.toMatch(/weight|96/i);
  });
});

describe('family shopping list STEP_183', () => {
  it('aggregates portions, deducts pantry, and keeps dish sources without medical reasons', () => {
    const items = buildFamilyShoppingList(
      [
        {
          dishName: 'oatmeal_bowl',
          servings: 1.5,
          ingredients: dish.ingredients,
        },
      ],
      [{ productKey: 'oats', name: 'oats', unit: 'g', quantity: 100, expiresOn: '2099-01-01' }],
    );
    const oats = items.find((item) => item.productKey === 'oats');
    expect(oats?.forDishes).toEqual(['oatmeal_bowl']);
    expect(JSON.stringify(items)).not.toMatch(/allerg|medical|weight|calorie target/i);
    expect(oats?.quantity).toBeGreaterThan(0);
  });

  it('rejects stale purchased updates', async () => {
    const repository = {
      member: vi.fn().mockResolvedValue({ id: 'm1', role: 'MEMBER', status: 'ACTIVE', healthShareConsent: false }),
      markShoppingItemPurchased: vi.fn().mockRejectedValue(new Error('FAMILY_SHOPPING_STALE')),
    };
    const service = new FamilyModeService(repository as never, { appendEvent: vi.fn() } as never);
    await expect(service.markFamilyShoppingPurchased('u1', 'f1', 'item', true, 1)).rejects.toThrow(
      'FAMILY_SHOPPING_STALE',
    );
  });
});
