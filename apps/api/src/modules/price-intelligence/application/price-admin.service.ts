import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { validateCsvCatalog } from '../domain/csv-catalog.validator';
import type {
  CreateProductInput,
  CsvValidationResult,
  ImportReport,
  ObservationFilters,
  UpdateProductInput,
  UpdateRetailerInput,
} from '../domain/price-admin.types';
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from '../domain/price-admin.types';
import { PriceIntelligenceRepository } from '../infrastructure/price-intelligence.repository';

@Injectable()
export class PriceAdminService {
  constructor(@Inject(PriceIntelligenceRepository) private readonly repository: PriceIntelligenceRepository) {}

  meta() {
    return { categories: PRODUCT_CATEGORIES, units: PRODUCT_UNITS };
  }

  async metaForSession(token?: string) {
    await this.authorize(token);
    return this.meta();
  }

  async metaLocal() {
    return this.meta();
  }

  async listRetailersForSession(token?: string) {
    await this.authorize(token);
    return { items: await this.repository.listRetailers() };
  }

  async listRetailersLocal() {
    return { items: await this.repository.listRetailers() };
  }

  async updateRetailerForSession(token: string | undefined, id: string, input: UpdateRetailerInput) {
    await this.authorize(token);
    const updated = await this.repository.updateRetailer(id, input);
    if (!updated) throw new Error('RETAILER_NOT_FOUND');
    return updated;
  }

  async updateRetailerLocal(id: string, input: UpdateRetailerInput) {
    const updated = await this.repository.updateRetailer(id, input);
    if (!updated) throw new Error('RETAILER_NOT_FOUND');
    return updated;
  }

  async listProductsForSession(token?: string) {
    await this.authorize(token);
    return { items: await this.repository.listProducts() };
  }

  async listProductsLocal() {
    return { items: await this.repository.listProducts() };
  }

  async createProductForSession(token: string | undefined, input: CreateProductInput) {
    await this.authorize(token);
    this.assertProductInput(input);
    return this.repository.createProduct(input);
  }

  async createProductLocal(input: CreateProductInput) {
    this.assertProductInput(input);
    return this.repository.createProduct(input);
  }

  async updateProductForSession(token: string | undefined, id: string, input: UpdateProductInput) {
    await this.authorize(token);
    const updated = await this.repository.updateProduct(id, input);
    if (!updated) throw new Error('PRODUCT_NOT_FOUND');
    return updated;
  }

  async updateProductLocal(id: string, input: UpdateProductInput) {
    const updated = await this.repository.updateProduct(id, input);
    if (!updated) throw new Error('PRODUCT_NOT_FOUND');
    return updated;
  }

  async listObservationsForSession(token: string | undefined, filters: ObservationFilters) {
    await this.authorize(token);
    return { items: await this.repository.listObservations(filters) };
  }

  async listObservationsLocal(filters: ObservationFilters) {
    return { items: await this.repository.listObservations(filters) };
  }

  validateCatalogCsv(payload: string): CsvValidationResult {
    const { rows, ...validation } = validateCsvCatalog(payload);
    void rows;
    return validation;
  }

  private assertProductInput(input: CreateProductInput) {
    if (!input.productKey?.trim() || !input.name?.trim() || !input.unit?.trim()) {
      throw new Error('PRODUCT_INVALID');
    }
  }

  private async authorize(token: string | undefined) {
    if (!token) {
      if (this.allowOpenAdmin()) return { userId: 'local', role: 'OWNER' };
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    const session = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!session || session.role !== 'OWNER') throw new Error('OWNER_ACCESS_FORBIDDEN');
    return session;
  }

  private allowOpenAdmin() {
    return process.env.ALLOW_OPEN_PRICE_INGEST === '1' || process.env.NODE_ENV !== 'production';
  }
}

export function toImportReport(
  result: {
    imported: number;
    productsCreated: number;
    productsUpdated: number;
    pricesImported: number;
    sourceType: string;
    sourceName: string;
  },
  validation?: CsvValidationResult,
): ImportReport {
  return {
    imported: result.imported,
    productsCreated: result.productsCreated,
    productsUpdated: result.productsUpdated,
    pricesImported: result.pricesImported,
    sourceType: result.sourceType as ImportReport['sourceType'],
    sourceName: result.sourceName,
    validation,
    errors: validation?.errors ?? [],
  };
}
