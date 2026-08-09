import { splitCosts } from '../../shopping-list/domain/shopping-list.policy';

export type IngredientPriceInput = {
  productId: string;
  displayName: string;
  amount: number;
  unit: string;
  packageSize?: number | null;
  packageUnit?: string | null;
  /** Price of one package in RUB, if known. */
  packagePriceRub?: number | null;
  collectedAt?: string | null;
  sourceName?: string | null;
  retailerName?: string | null;
};

export type IngredientCostLine = {
  productId: string;
  displayName: string;
  consumedCostRub: number | null;
  packageCostRub: number | null;
  priceStatus: 'confirmed' | 'estimated' | 'missing' | 'legacy' | 'partial';
  collectedAt?: string;
  sourceName?: string;
  retailerName?: string;
};

export type DishCostSummary = {
  consumedCostRub: number | null;
  packageCostRub: number | null;
  /** Aliases for contract clarity */
  consumedCost?: number | null;
  packageCost?: number | null;
  pricedIngredientCount: number;
  missingIngredientCount: number;
  missingPriceCount?: number;
  complete: boolean;
  status: 'confirmed' | 'estimated' | 'partial' | 'missing';
  priceStatus?: 'confirmed' | 'estimated' | 'partial' | 'missing';
  priceSource?: string | null;
  priceSourceLabel?: string | null;
  retailer?: string | null;
  observedAt?: string | null;
  stale?: boolean;
  lines: IngredientCostLine[];
  asOf?: string;
  sourceName?: string;
};

export function priceSourceLabel(provenance: string | null | undefined): string | null {
  switch (provenance) {
    case 'CURATED_PRODUCT_SUBSTITUTION':
      return 'Проверенная замена';
    case 'HEURISTIC_CATALOG_MATCH':
      return 'Подобрано по составу';
    case 'RETAIL_PRODUCT_PRICE':
    case 'PRICE_OBSERVATION':
      return 'Цена из магазина';
    case 'LEGACY_PRODUCT_PRICE':
      return 'Использована старая цена';
    case 'PRICE_INCOMPLETE':
      return 'Цена неполная';
    case 'PRICE_MISSING':
      return 'Цена отсутствует';
    default:
      return provenance ? 'Цена из каталога' : null;
  }
}

export function costForIngredient(input: IngredientPriceInput): IngredientCostLine {
  if (input.packagePriceRub == null || !(input.packagePriceRub >= 0) || !(input.packageSize && input.packageSize > 0)) {
    return {
      productId: input.productId,
      displayName: input.displayName,
      consumedCostRub: null,
      packageCostRub: null,
      priceStatus: 'missing',
    };
  }
  const costs = splitCosts(input.amount, input.packageSize, input.packagePriceRub, input.amount);
  return {
    productId: input.productId,
    displayName: input.displayName,
    consumedCostRub: roundMoney(costs.consumedCost),
    packageCostRub: roundMoney(costs.purchaseCost),
    priceStatus: 'confirmed',
    collectedAt: input.collectedAt ?? undefined,
    sourceName: input.sourceName ?? undefined,
    retailerName: input.retailerName ?? undefined,
  };
}

export function summarizeDishCost(lines: IngredientCostLine[]): DishCostSummary {
  const priced = lines.filter((line) => line.consumedCostRub != null);
  const missing = lines.length - priced.length;
  if (priced.length === 0) {
    return {
      consumedCostRub: null,
      packageCostRub: null,
      consumedCost: null,
      packageCost: null,
      pricedIngredientCount: 0,
      missingIngredientCount: missing,
      missingPriceCount: missing,
      complete: false,
      status: 'missing',
      priceStatus: 'missing',
      priceSource: null,
      priceSourceLabel: 'Цена отсутствует',
      retailer: null,
      observedAt: null,
      stale: false,
      lines,
    };
  }
  const consumed = roundMoney(priced.reduce((sum, line) => sum + (line.consumedCostRub ?? 0), 0));
  const packages = roundMoney(priced.reduce((sum, line) => sum + (line.packageCostRub ?? 0), 0));
  const asOf = priced.map((line) => line.collectedAt).filter(Boolean).sort().at(-1);
  const sourceName = priced.find((line) => line.sourceName)?.sourceName;
  const retailer = priced.find((line) => line.retailerName)?.retailerName;
  const status = missing === 0 ? 'confirmed' : 'partial';
  return {
    consumedCostRub: consumed,
    packageCostRub: packages,
    consumedCost: consumed,
    packageCost: packages,
    pricedIngredientCount: priced.length,
    missingIngredientCount: missing,
    missingPriceCount: missing,
    complete: missing === 0,
    status,
    priceStatus: status,
    priceSource: sourceName ?? null,
    priceSourceLabel: priceSourceLabel(sourceName),
    retailer: retailer ?? null,
    observedAt: asOf ?? null,
    stale: false,
    lines,
    asOf,
    sourceName,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
