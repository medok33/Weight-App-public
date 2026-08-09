export type PriceReview = {
  items: Array<{
    id: string;
    productId: string;
    storeId: string;
    price: number;
    observedAt: string;
    source: string;
    sourceType?: string;
    sourceName?: string;
    collectedAt?: string;
  }>;
  role: string;
};

export type RetailerAdminView = {
  id: string;
  key: string;
  code: string;
  name: string;
  type: string;
  region: string;
  active: boolean;
};

export type ProductAdminView = {
  id: string;
  productKey: string;
  name: string;
  category: string;
  unit: string;
  weight?: string;
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
  sourceType: string;
  sourceName: string;
  collectedAt: string;
  observedAt: string;
};

export type CsvValidationResult = {
  valid: boolean;
  requiredColumns: string[];
  missingColumns: string[];
  rowCount: number;
  validRowCount: number;
  errors: Array<{ line: number; field?: string; message: string }>;
};

export type ImportReport = {
  imported: number;
  productsCreated: number;
  productsUpdated: number;
  pricesImported: number;
  productsUpserted?: number;
  sourceType: string;
  sourceName: string;
  validation?: CsvValidationResult;
  errors: Array<{ line: number; field?: string; message: string }>;
};

export type AdminMeta = {
  categories: string[];
  units: string[];
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
