import type { PriceSourceType } from './price-intelligence.types';
import type { NormalizedProduct, RetailerEntity } from './retailer-entity';

export const PRODUCT_CATEGORIES = [
  'protein',
  'dairy',
  'grains',
  'vegetables',
  'fruit',
  'oils',
  'snacks',
  'beverages',
  'other',
] as const;

export const PRODUCT_UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'pack'] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export type RetailerAdminView = RetailerEntity & {
  type: string;
  key: string;
};

export type ProductAdminView = NormalizedProduct & {
  caloriesPer100g: number;
  proteinPer100g: number;
  createdAt: string;
};

export type ObservationAdminView = {
  id: string;
  productId: string;
  productKey: string;
  productName: string;
  retailerId?: string;
  retailerName?: string;
  retailerCode?: string;
  price: number;
  currency: string;
  sourceType: PriceSourceType;
  sourceName: string;
  collectedAt: string;
  observedAt: string;
};

export type CsvValidationError = {
  line: number;
  field?: string;
  message: string;
};

export type CsvValidationResult = {
  valid: boolean;
  requiredColumns: string[];
  missingColumns: string[];
  rowCount: number;
  validRowCount: number;
  errors: CsvValidationError[];
};

export type ImportReport = {
  imported: number;
  productsCreated: number;
  productsUpdated: number;
  pricesImported: number;
  sourceType: PriceSourceType;
  sourceName: string;
  validation?: CsvValidationResult;
  errors: CsvValidationError[];
};

export type CreateProductInput = {
  productKey: string;
  name: string;
  category: string;
  unit: string;
  weight?: string;
  caloriesPer100g?: number;
  proteinPer100g?: number;
};

export type UpdateProductInput = Partial<CreateProductInput>;

export type UpdateRetailerInput = {
  name?: string;
  region?: string;
  active?: boolean;
};

export type ObservationFilters = {
  productId?: string;
  retailerId?: string;
  sourceType?: PriceSourceType;
  limit?: number;
};
