import { Inject, Injectable } from '@nestjs/common';
import type { RetailerPriceProvider, RetailerSyncResult } from '../domain/retailer-price-provider';
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
    const timeoutMs = Number(process.env.PRICE_PROVIDER_TIMEOUT_MS ?? 10_000);
    const result = await Promise.race([
      this.repository.syncFromRetailerProvider(provider, auditUserId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PRICE_PROVIDER_TIMEOUT')), timeoutMs)),
    ]);
    return { ...result, imported: result.prices };
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
