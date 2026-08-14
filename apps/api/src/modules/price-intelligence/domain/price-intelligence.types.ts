import type { PriceCondition, ReferencePriceEvidence } from './reference-price.core';

/** Stable provenance for price rows — DB never encodes a specific retailer API. */
export type PriceSourceType = 'API' | 'CSV' | 'MANUAL' | 'PARSER';

export type Retailer = { id: string; key: string; name: string; type: string };
export type Region = { id: string; code: string };
export type RetailStore = { id: string; retailerId: string; regionId: string; name: string; city?: string; address?: string; locationScope?: string };
export type ExternalProduct = { id: string; source: string; externalId: string; name: string };
export type ProductMatch = { productId: string; externalProductId: string; confidence: number };

export type PriceObservation = {
  id?: string;
  productId: string;
  storeId: string;
  retailerId?: string;
  price: number;
  currency: string;
  sourceType: PriceSourceType;
  sourceName: string;
  /** @deprecated prefer collectedAt — kept for legacy callers */
  source?: string;
  observedAt: string;
  collectedAt: string;
  retailProductId?: string;
  observationKey?: string;
  normalizedPackageQuantity?: number;
  normalizedPackageUnit?: string;
  unitPrice?: number;
  unitPriceUnit?: string;
  priceCondition?: PriceCondition;
  dataClass?: string;
};

export type PriceSnapshot = {
  productId: string;
  regionId: string;
  price: number;
  confidence: number;
  observedAt: string;
  sourceType?: PriceSourceType;
  sourceName?: string;
};

export type PriceEvidenceRead = ReferencePriceEvidence;

export type PriceImportRow = {
  productId: string;
  storeId: string;
  price: number;
  observedAt: string;
  source?: string;
  currency?: string;
  sourceType?: PriceSourceType;
  sourceName?: string;
  retailerId?: string;
  collectedAt?: string;
};

export type ReviewItem = PriceObservation & { reason: string; id: string };

export type OpenDataPriceRow = {
  productKey?: string;
  productName: string;
  category?: string;
  brand?: string;
  weight?: string;
  price: number;
  currency?: string;
  retailer: string;
  retailerKey?: string;
  retailerType?: string;
  date?: string;
};

export type ManualPriceRow = {
  productKey: string;
  name: string;
  price: number;
  retailer: string;
  retailerKey?: string;
  retailerType?: string;
  currency?: string;
  date?: string;
};

export type IngestResult = {
  imported: number;
  productsUpserted: number;
  sourceType: PriceSourceType;
  sourceName: string;
};
