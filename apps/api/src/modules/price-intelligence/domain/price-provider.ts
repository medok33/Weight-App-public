import type { PriceSourceType } from '../domain/price-intelligence.types';
import type { RetailerType } from '../domain/retailer.types';

export type ProviderProduct = {
  externalId: string;
  name: string;
  productKey?: string;
  category?: string;
  brand?: string;
  weight?: string;
};

export type ProviderRetailer = {
  key: string;
  name: string;
  type: RetailerType;
};

export type ProviderPrice = {
  productKey?: string;
  externalId?: string;
  name: string;
  price: number;
  currency: string;
  retailer: ProviderRetailer;
  collectedAt: string;
};

export type ProviderAvailability = {
  productKey?: string;
  externalId?: string;
  name?: string;
  available: boolean;
  retailer: ProviderRetailer;
};

/**
 * Source-agnostic price provider contract.
 * Retailer APIs, file imports, manual admin, and future parsers all implement this.
 * Downstream (Shopping List / Dashboard / Meal Plan) must only consume PriceObservation + Retailer.id/type.
 */
export interface PriceProvider {
  readonly id: string;
  readonly sourceType: PriceSourceType;
  readonly sourceName: string;
  getProducts(): Promise<ProviderProduct[]>;
  getPrices(): Promise<ProviderPrice[]>;
  getAvailability(): Promise<ProviderAvailability[]>;
}
