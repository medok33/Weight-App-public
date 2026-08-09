import type { ManualPriceRow, OpenDataPriceRow, PriceObservation, PriceSnapshot, PriceSourceType } from './price-intelligence.types';
import { normalizeRetailerRef } from './retailer.types';

const SOURCE_RANK: Record<PriceSourceType, number> = {
  API: 4,
  CSV: 3,
  MANUAL: 2,
  PARSER: 1,
};

export function validateObservation(observation: PriceObservation) {
  if (!observation.productId || !observation.storeId || observation.price < 0 || !observation.collectedAt) {
    throw new Error('PRICE_OBSERVATION_INVALID');
  }
  return observation;
}

export function rankSources(observations: PriceObservation[], now = Date.now()): PriceSnapshot | undefined {
  if (!observations.length) return undefined;
  const valid = observations.map(validateObservation).sort((a, b) => {
    const byType = (SOURCE_RANK[b.sourceType] ?? 0) - (SOURCE_RANK[a.sourceType] ?? 0);
    if (byType !== 0) return byType;
    return Date.parse(b.collectedAt) - Date.parse(a.collectedAt);
  });
  const best = valid[0]!;
  const ageDays = Math.max(0, (now - Date.parse(best.collectedAt)) / 86_400_000);
  const base = best.sourceType === 'API' ? 0.9 : best.sourceType === 'CSV' ? 0.75 : best.sourceType === 'MANUAL' ? 0.7 : 0.55;
  return {
    productId: best.productId,
    regionId: best.storeId,
    price: best.price,
    confidence: Math.max(0, Math.min(1, base * Math.exp(-ageDays / 30))),
    observedAt: best.collectedAt,
    sourceType: best.sourceType,
    sourceName: best.sourceName,
  };
}

/** @deprecated legacy CSV with productId,storeId UUIDs — prefer open-data parsers */
export function parsePriceCsv(csv: string) {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [productId, storeId, price, observedAt] = line.split(',');
      if (!productId || !storeId || !Number.isFinite(Number(price))) throw new Error('PRICE_IMPORT_INVALID');
      return {
        productId,
        storeId,
        price: Number(price),
        observedAt: observedAt || new Date().toISOString(),
        source: 'csv',
        sourceType: 'CSV' as const,
        sourceName: 'Legacy CSV import',
        currency: 'RUB',
        collectedAt: observedAt || new Date().toISOString(),
      };
    });
}

export function estimatePrice(observations: PriceObservation[], fallbackPrice?: number) {
  const snapshot = rankSources(observations);
  return snapshot ?? (fallbackPrice === undefined ? undefined : { price: fallbackPrice, confidence: 0.2, fallback: true });
}

export function reviewQueue(observations: Array<PriceObservation & { id?: string }>) {
  return observations
    .filter((o) => o.price <= 0 || o.sourceType === 'PARSER' || o.sourceName === 'unknown')
    .map((o) => ({
      ...o,
      id: o.id ?? `${o.productId}:${o.storeId}`,
      reason: o.price <= 0 ? 'INVALID_PRICE' : 'UNTRUSTED_SOURCE',
    }));
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function mapOpenDataRow(row: Record<string, string>): OpenDataPriceRow {
  const productName = pick(row, ['product_name', 'name', 'product', 'title']);
  const priceRaw = pick(row, ['price', 'unit_price', 'cost']);
  const retailer = pick(row, ['retailer', 'store', 'shop', 'merchant']);
  const price = Number(String(priceRaw ?? '').replace(',', '.'));
  if (!productName || !retailer || !Number.isFinite(price)) throw new Error('PRICE_IMPORT_INVALID');
  return {
    productKey: pick(row, ['product_key', 'productkey', 'sku', 'key']),
    productName,
    category: pick(row, ['category']),
    brand: pick(row, ['brand']),
    weight: pick(row, ['weight', 'net_weight', 'size']),
    price,
    currency: pick(row, ['currency']) ?? 'RUB',
    retailer,
    retailerKey: pick(row, ['retailer_key', 'retailerkey', 'store_key']),
    retailerType: pick(row, ['retailer_type', 'retailertype', 'store_type']),
    date: pick(row, ['date', 'observed_at', 'collected_at']),
  };
}

export function parseOpenDataCsv(csv: string, delimiter = ','): OpenDataPriceRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('PRICE_IMPORT_INVALID');
  const headers = splitDelimitedLine(lines[0]!, delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return mapOpenDataRow(row);
  });
}

export function parseOpenDataJson(payload: string): OpenDataPriceRow[] {
  const parsed = JSON.parse(payload) as unknown;
  const rows = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown[] }).items;
  if (!Array.isArray(rows)) throw new Error('PRICE_IMPORT_INVALID');
  return rows.map((item) => {
    const row = item as Record<string, unknown>;
    return mapOpenDataRow(
      Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value ?? '')])),
    );
  });
}

export function parseOpenDataXml(payload: string): OpenDataPriceRow[] {
  const items = [...payload.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if (!items.length) throw new Error('PRICE_IMPORT_INVALID');
  return items.map((match) => {
    const body = match[1] ?? '';
    const field = (name: string) => {
      const found = body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
      return found?.[1]?.trim() ?? '';
    };
    return mapOpenDataRow({
      product_key: field('product_key') || field('productKey'),
      product_name: field('product_name') || field('name'),
      category: field('category'),
      brand: field('brand'),
      weight: field('weight'),
      price: field('price'),
      currency: field('currency'),
      retailer: field('retailer'),
      retailer_key: field('retailer_key') || field('retailerKey'),
      retailer_type: field('retailer_type') || field('retailerType'),
      date: field('date') || field('collected_at'),
    });
  });
}

/** Excel-exported TSV / pasted sheet (not binary .xlsx). Binary OOXML → convert to CSV first. */
export function parseOpenDataXlsxOrTsv(payload: string): OpenDataPriceRow[] {
  if (payload.startsWith('PK')) throw new Error('XLSX_BINARY_UNSUPPORTED_EXPORT_CSV');
  const delimiter = payload.includes('\t') ? '\t' : ',';
  return parseOpenDataCsv(payload, delimiter);
}

export function parseManualCsv(csv: string): ManualPriceRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('PRICE_IMPORT_INVALID');
  const headers = splitDelimitedLine(lines[0]!, ',').map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, ',');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    const productKey = pick(row, ['product_key', 'productkey', 'key', 'sku']);
    const name = pick(row, ['name', 'product_name', 'title']);
    const retailer = pick(row, ['retailer', 'store', 'shop']);
    const price = Number(String(pick(row, ['price']) ?? '').replace(',', '.'));
    if (!productKey || !name || !retailer || !Number.isFinite(price)) throw new Error('PRICE_IMPORT_INVALID');
    return {
      productKey,
      name,
      price,
      retailer,
      retailerKey: pick(row, ['retailer_key', 'retailerkey', 'store_key']),
      retailerType: pick(row, ['retailer_type', 'retailertype', 'store_type']),
      currency: pick(row, ['currency']) ?? 'RUB',
      date: pick(row, ['date', 'collected_at']),
    };
  });
}

export function parseManualJson(payload: string): ManualPriceRow[] {
  const parsed = JSON.parse(payload) as unknown;
  if (!Array.isArray(parsed)) throw new Error('PRICE_IMPORT_INVALID');
  return parsed.map((item) => {
    const row = item as Record<string, unknown>;
    return parseManualCsv(
      `product_key,name,price,retailer\n${row.product_key ?? row.productKey},${row.name},${row.price},${row.retailer}`,
    )[0]!;
  });
}

export function retailerRefFromImport(row: { retailer: string; retailerKey?: string; retailerType?: string }) {
  return normalizeRetailerRef({ name: row.retailer, key: row.retailerKey, type: row.retailerType });
}

export function formatSourceLabel(sourceType: PriceSourceType, sourceName: string, collectedAt?: string): string {
  if (sourceType === 'CSV' && collectedAt) {
    const day = collectedAt.slice(0, 10);
    return `${sourceName} ${day}`;
  }
  return sourceName;
}
