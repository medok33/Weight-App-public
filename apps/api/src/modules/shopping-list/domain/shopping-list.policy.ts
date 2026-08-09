import type { ShoppingItemInput } from './shopping-list.types';

export type AggregatedShoppingItem = {
  productKey: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  packageSize: number;
  packagePrice: number;
};

export function roundPackages(quantity: number, packageSize: number) {
  if (quantity < 0 || packageSize <= 0) throw new Error('SHOPPING_QUANTITY_INVALID');
  return Math.ceil(quantity / packageSize) * packageSize;
}

export function aggregateCatalogIngredients(
  items: Array<{
    productKey: string;
    name: string;
    category: string;
    quantity: number;
    unit: string;
    packageSize: number;
    fallbackUnitPrice: number;
  }>,
): AggregatedShoppingItem[] {
  const grouped = new Map<string, AggregatedShoppingItem>();
  for (const item of items) {
    if (item.quantity < 0 || !item.unit) throw new Error('SHOPPING_ITEM_INVALID');
    const key = `${item.productKey}:${item.unit}`;
    const prior = grouped.get(key);
    const quantity = (prior?.quantity ?? 0) + item.quantity;
    grouped.set(key, {
      productKey: item.productKey,
      name: item.name,
      category: item.category,
      quantity,
      unit: item.unit,
      packageSize: item.packageSize,
      packagePrice: item.fallbackUnitPrice,
    });
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    quantity: roundPackages(item.quantity, item.packageSize),
  }));
}

/** @deprecated kept for existing unit tests */
export function aggregateIngredients(items: ShoppingItemInput[]) {
  const grouped = new Map<string, { productId?: string; unit: string; quantity: number }>();
  for (const item of items) {
    if (item.quantity < 0 || !item.unit) throw new Error('SHOPPING_ITEM_INVALID');
    const key = `${item.productId ?? ''}:${item.unit}`;
    const quantity = item.packageSize ? roundPackages(item.quantity, item.packageSize) : item.quantity;
    const prior = grouped.get(key);
    grouped.set(key, { productId: item.productId, unit: item.unit, quantity: (prior?.quantity ?? 0) + quantity });
  }
  return [...grouped.values()];
}

export function splitCosts(quantity: number, packageSize: number, packagePrice: number, consumedQuantity = quantity) {
  if (quantity < 0 || packageSize <= 0 || packagePrice < 0 || consumedQuantity < 0) throw new Error('SHOPPING_COST_INVALID');
  return {
    purchaseCost: Math.ceil(quantity / packageSize) * packagePrice,
    consumedCost: (consumedQuantity / packageSize) * packagePrice,
  };
}
