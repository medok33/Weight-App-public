import { Inject, Injectable } from '@nestjs/common';
import {
  parseManualCsv,
  parseManualJson,
  parseOpenDataCsv,
  parseOpenDataJson,
  parseOpenDataXml,
  parseOpenDataXlsxOrTsv,
} from '../domain/price-intelligence.policy';
import type { IngestResult, ManualPriceRow, OpenDataPriceRow } from '../domain/price-intelligence.types';
import type { PriceProvider } from '../domain/price-provider';
import { CsvImportProvider } from '../providers/csv-import.provider';
import { ManualProvider } from '../providers/manual.provider';
import { MockOfficialApiProvider } from '../providers/mock-official-api.provider';
import { PriceIntelligenceRepository } from '../infrastructure/price-intelligence.repository';
import { PriceIntelligenceEngine } from './price-intelligence.engine';

export type OpenDataFormat = 'csv' | 'json' | 'xml' | 'xlsx' | 'tsv';

@Injectable()
export class PriceIngestionService {
  constructor(
    @Inject(PriceIntelligenceRepository) private readonly repository: PriceIntelligenceRepository,
    @Inject(PriceIntelligenceEngine) private readonly engine: PriceIntelligenceEngine,
  ) {}

  async ingestProvider(provider: PriceProvider, auditUserId?: string): Promise<IngestResult> {
    return this.repository.ingestFromProvider(provider, auditUserId);
  }

  async syncMockOfficialApi(sourceName = 'Mock Official API', auditUserId?: string): Promise<IngestResult> {
    return this.ingestProvider(new MockOfficialApiProvider(sourceName), auditUserId);
  }

  /** Preferred catalog import: RetailerPriceProvider → Product + PriceObservation. */
  async syncCsvCatalog(payload: string, sourceName?: string, retailerCode?: string, auditUserId?: string) {
    const result = await this.engine.syncCsvCatalog(payload, { sourceName, retailerCode, auditUserId });
    return {
      ...result,
      productsUpserted: result.productsCreated + result.productsUpdated,
      categories: 0,
      availability: 0,
    };
  }

  validateCsvCatalog(payload: string) {
    return this.engine.validateCsvCatalog(payload);
  }

  async ingestOpenData(format: OpenDataFormat, payload: string, sourceName?: string, auditUserId?: string): Promise<IngestResult> {
    if (format === 'csv' || format === 'tsv' || format === 'xlsx') {
      try {
        return await this.syncCsvCatalog(
          payload,
          sourceName ?? `Импорт CSV ${new Date().toISOString().slice(0, 10)}`,
          undefined,
          auditUserId,
        );
      } catch {
        // Fall through to legacy open-data shape (product_name without product_key).
      }
    }
    const rows = this.parseOpenData(format, payload);
    const label =
      sourceName ??
      (format === 'csv' || format === 'tsv' || format === 'xlsx'
        ? `Импорт Excel ${new Date().toISOString().slice(0, 10)}`
        : `Импорт ${format.toUpperCase()} ${new Date().toISOString().slice(0, 10)}`);
    return this.ingestProvider(new CsvImportProvider(rows, label), auditUserId);
  }

  async ingestManual(rows: ManualPriceRow[], sourceName?: string, auditUserId?: string): Promise<IngestResult> {
    const label = sourceName ?? `Ручной импорт ${new Date().toISOString().slice(0, 10)}`;
    return this.ingestProvider(new ManualProvider(rows, label), auditUserId);
  }

  async ingestManualPayload(format: 'csv' | 'json', payload: string, sourceName?: string, auditUserId?: string): Promise<IngestResult> {
    const rows = format === 'json' ? parseManualJson(payload) : parseManualCsv(payload);
    return this.ingestManual(rows, sourceName, auditUserId);
  }

  parseOpenData(format: OpenDataFormat, payload: string): OpenDataPriceRow[] {
    switch (format) {
      case 'csv':
        return parseOpenDataCsv(payload, ',');
      case 'tsv':
        return parseOpenDataCsv(payload, '\t');
      case 'json':
        return parseOpenDataJson(payload);
      case 'xml':
        return parseOpenDataXml(payload);
      case 'xlsx':
        return parseOpenDataXlsxOrTsv(payload);
      default:
        throw new Error('PRICE_IMPORT_FORMAT_UNSUPPORTED');
    }
  }
}
