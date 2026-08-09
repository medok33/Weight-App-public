import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { estimatePrice, parsePriceCsv, rankSources, reviewQueue } from '../domain/price-intelligence.policy';
import type { ManualPriceRow, PriceObservation } from '../domain/price-intelligence.types';
import { PriceIntelligenceRepository } from '../infrastructure/price-intelligence.repository';
import { PriceIngestionService, type OpenDataFormat } from './price-ingestion.service';

@Injectable()
export class PriceIntelligenceService {
  constructor(
    @Inject(PriceIntelligenceRepository) private readonly repository: PriceIntelligenceRepository,
    @Inject(PriceIngestionService) private readonly ingestion: PriceIngestionService,
  ) {}

  snapshot(observations: PriceObservation[]) {
    return rankSources(observations);
  }

  importCsv(csv: string) {
    return parsePriceCsv(csv);
  }

  estimate(observations: PriceObservation[], fallback?: number) {
    return estimatePrice(observations, fallback);
  }

  review(observations: PriceObservation[]) {
    return reviewQueue(observations);
  }

  async reviewForSession(token?: string) {
    const session = await this.authorize(token);
    return { items: await this.repository.review(), role: session.role };
  }

  async importForSession(token: string | undefined, csv: string) {
    const session = await this.authorize(token);
    const rows = parsePriceCsv(csv);
    return this.repository.importRows(session.userId, rows);
  }

  async ingestOpenDataForSession(token: string | undefined, format: OpenDataFormat, payload: string, sourceName?: string) {
    const session = await this.authorize(token);
    return this.ingestion.ingestOpenData(format, payload, sourceName, session.userId);
  }

  async ingestManualForSession(token: string | undefined, rows: ManualPriceRow[], sourceName?: string) {
    const session = await this.authorize(token);
    return this.ingestion.ingestManual(rows, sourceName, session.userId);
  }

  async ingestManualCsvForSession(token: string | undefined, csv: string, sourceName?: string) {
    const session = await this.authorize(token);
    return this.ingestion.ingestManualPayload('csv', csv, sourceName, session.userId);
  }

  async syncMockApiForSession(token: string | undefined, sourceName?: string) {
    const session = await this.authorize(token);
    return this.ingestion.syncMockOfficialApi(sourceName, session.userId);
  }

  /** Local/dev verification without owner MFA — still writes durable PriceObservation rows. */
  async ingestOpenDataLocal(format: OpenDataFormat, payload: string, sourceName?: string) {
    return this.ingestion.ingestOpenData(format, payload, sourceName);
  }

  async ingestManualLocal(rows: ManualPriceRow[], sourceName?: string) {
    return this.ingestion.ingestManual(rows, sourceName);
  }

  async syncMockApiLocal(sourceName?: string) {
    return this.ingestion.syncMockOfficialApi(sourceName);
  }

  async syncCatalogCsvForSession(token: string | undefined, payload: string, sourceName?: string, retailerCode?: string) {
    const session = await this.authorize(token);
    return this.ingestion.syncCsvCatalog(payload, sourceName, retailerCode, session.userId);
  }

  async syncCatalogCsvLocal(payload: string, sourceName?: string, retailerCode?: string) {
    return this.ingestion.syncCsvCatalog(payload, sourceName, retailerCode);
  }

  async ingestManualCsvLocal(csv: string, sourceName?: string) {
    return this.ingestion.ingestManualPayload('csv', csv, sourceName);
  }

  private async authorize(token?: string) {
    if (!token) throw new Error('OWNER_ACCESS_FORBIDDEN');
    const session = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!session || session.role !== 'OWNER') {
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    return session;
  }
}
