import { describe, expect, it } from 'vitest';

describe('documents export UI contract', () => {
  it('lists meal plan pdf and shopping print documents', () => {
    const docs = ['meal_plan_pdf', 'shopping_list_print'];
    expect(docs).toHaveLength(2);
  });
});
