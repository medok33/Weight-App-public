import { Inject, Injectable } from '@nestjs/common';
import type { RetailerPriceProvider, RetailerProviderPayload, RetailerSyncResult } from '../domain/retailer-price-provider';
import { validateCsvCatalog } from '../domain/csv-catalog.validator';
import type { CsvValidationResult, ImportReport } from '../domain/price-admin.types';
import { toImportReport } from './price-admin.service';
import { CsvRetailerPriceProvider } from '../providers/csv-retailer-price.provider';
import { PriceIntelligenceRepository } from '../infrastructure/price-intelligence.repository';

/**
 * Price Intelligence Engine — orchestrates RetailerPriceProvider sync into Product + PriceObservation.
 * Shopping List / Dashboard never call providers directly.
 */
@Injectable()
export class PriceIntelligenceEngine {
  constructor(@Inject(PriceIntelligenceRepository) private readonly repository: PriceIntelligenceRepository) {}

  async syncProvider(provider: RetailerPriceProvider, auditUserId?: string): Promise<RetailerSyncResult & { sourceType: string; sourceName: string; imported: number; productsCreated: number; productsUpdated: number; pricesImported: number }> {
    const configured = Number(process.env.PRICE_PROVIDER_TIMEOUT_MS ?? 10_000);
    if (!Number.isFinite(configured) || configured < 100 || configured > 300_000) throw new Error('PRICE_PROVIDER_TIMEOUT_CONFIG_INVALID');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const collection = Promise.all([
      provider.syncCategories(controller.signal), provider.syncProducts(controller.signal),
      provider.syncPrices(controller.signal), provider.syncAvailability(controller.signal),
    ]).then(([categories, products, prices, availability]) => ({ categories, products, prices, availability }));
    let payload: RetailerProviderPayload;
    try {
      payload = await Promise.race([
        collection,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('PRICE_PROVIDER_TIMEOUT')); }, configured);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const counts = [payload.categories.length, payload.products.length, payload.prices.length, payload.availability.length];
    if (counts.some((count) => count > 10_000)) throw new Error('PRICE_PROVIDER_RESULT_TOO_LARGE');
    // Publication starts only after source collection completed before the deadline.
    // A late source promise has no repository capability and therefore cannot write.
    const result = await this.repository.syncRetailerProviderPayload(provider, payload, auditUserId);
    return { ...result, imported: result.prices };
  }

  async syncProviders(providers: RetailerPriceProvider[], auditUserId?: string) {
    if (providers.length > 20) throw new Error('PRICE_PROVIDER_CONCURRENCY_LIMIT_EXCEEDED');
    const settled = await Promise.all(providers.map(async (provider) => {
      try {
        const result = await this.syncProvider(provider, auditUserId);
        return result.prices === 0
          ? { providerId: provider.providerId, status: 'NO_DATA' as const, result }
          : { providerId: provider.providerId, status: 'SUCCESS' as const, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PRICE_PROVIDER_ERROR';
        const status = message === 'PRICE_PROVIDER_TIMEOUT'
          ? 'TIMEOUT' as const
          : message === 'PRICE_PROVIDER_SOURCE_UNAVAILABLE'
            ? 'SOURCE_UNAVAILABLE' as const
            : 'ERROR' as const;
        return { providerId: provider.providerId, status, error: message };
      }
    }));
    return settled;
  }

  validateCsvCatalog(payload: string): CsvValidationResult & { rows: import('../providers/csv-retailer-price.provider').CsvCatalogRow[] } {
    return validateCsvCatalog(payload);
  }

  async syncCsvCatalog(payload: string, options?: { sourceName?: string; retailerCode?: string; auditUserId?: string; skipInvalidRows?: boolean }): Promise<ImportReport> {
    const validation = validateCsvCatalog(payload);
    if (!validation.valid && !options?.skipInvalidRows) {
      return toImportReport(
        { imported: 0, productsCreated: 0, productsUpdated: 0, pricesImported: 0, sourceType: 'CSV', sourceName: options?.sourceName ?? 'Импорт CSV' },
        validation,
      );
    }
    if (!validation.rows.length) {
      return toImportReport(
        { imported: 0, productsCreated: 0, productsUpdated: 0, pricesImported: 0, sourceType: 'CSV', sourceName: options?.sourceName ?? 'Импорт CSV' },
        validation,
      );
    }
    const provider = new CsvRetailerPriceProvider(validation.rows, {
      sourceName: options?.sourceName ?? 'Импорт CSV',
      retailerCode: options?.retailerCode,
    });
    const result = await this.syncProvider(provider, options?.auditUserId);
    return toImportReport(
      {
        imported: result.imported,
        productsCreated: result.productsCreated,
        productsUpdated: result.productsUpdated,
        pricesImported: result.pricesImported,
        sourceType: result.sourceType,
        sourceName: result.sourceName,
      },
      validation,
    );
  }
}
