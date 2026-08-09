import type { CsvCatalogRow } from '../providers/csv-retailer-price.provider';
import type { CsvValidationError, CsvValidationResult } from './price-admin.types';

const REQUIRED_ALIASES: Record<string, string[]> = {
  product_key: ['product_key', 'productkey', 'key'],
  name: ['name', 'product_name', 'productname'],
  price: ['price'],
  retailer: ['retailer', 'store', 'shop'],
};

const REQUIRED_COLUMNS = Object.keys(REQUIRED_ALIASES);

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function resolveColumn(headers: string[], aliases: string[]): string | undefined {
  return headers.find((header) => aliases.includes(header));
}

function parseRow(
  row: Record<string, string>,
  headers: string[],
  line: number,
): { row?: CsvCatalogRow; errors: CsvValidationError[] } {
  const errors: CsvValidationError[] = [];
  const productKeyCol = resolveColumn(headers, REQUIRED_ALIASES.product_key!);
  const nameCol = resolveColumn(headers, REQUIRED_ALIASES.name!);
  const priceCol = resolveColumn(headers, REQUIRED_ALIASES.price!);
  const retailerCol = resolveColumn(headers, REQUIRED_ALIASES.retailer!);

  const productKey = productKeyCol ? row[productKeyCol]?.trim() : '';
  const name = nameCol ? row[nameCol]?.trim() : '';
  const priceRaw = priceCol ? row[priceCol]?.trim() : '';
  const retailer = retailerCol ? row[retailerCol]?.trim() : '';

  if (!productKey) errors.push({ line, field: 'product_key', message: 'product_key is required' });
  if (!name) errors.push({ line, field: 'name', message: 'name is required' });
  if (!retailer) errors.push({ line, field: 'retailer', message: 'retailer is required' });

  const price = Number(String(priceRaw).replace(',', '.'));
  if (!priceRaw) errors.push({ line, field: 'price', message: 'price is required' });
  else if (!Number.isFinite(price) || price < 0) errors.push({ line, field: 'price', message: 'price must be a non-negative number' });

  if (errors.length) return { errors };

  return {
    row: {
      productKey: productKey!,
      name: name!,
      category: row.category?.trim() || 'other',
      weight: row.weight?.trim() || undefined,
      unit: row.unit?.trim() || 'g',
      price: price!,
      retailer: retailer!,
      retailerCode: row.retailer_code || row.retailercode || undefined,
      currency: row.currency?.trim() || 'RUB',
      collectedAt: row.date || row.collected_at || undefined,
    },
    errors: [],
  };
}

/** Validates catalog CSV/XLSX-exported TSV without failing on first bad row. */
export function validateCsvCatalog(csv: string): CsvValidationResult & { rows: CsvCatalogRow[] } {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const errors: CsvValidationError[] = [];

  if (lines.length < 2) {
    return {
      valid: false,
      requiredColumns: REQUIRED_COLUMNS,
      missingColumns: REQUIRED_COLUMNS,
      rowCount: 0,
      validRowCount: 0,
      errors: [{ line: 1, message: 'File must include a header row and at least one data row' }],
      rows: [],
    };
  }

  const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !resolveColumn(headers, REQUIRED_ALIASES[col]!));

  if (missingColumns.length) {
    return {
      valid: false,
      requiredColumns: REQUIRED_COLUMNS,
      missingColumns,
      rowCount: lines.length - 1,
      validRowCount: 0,
      errors: missingColumns.map((col) => ({ line: 1, field: col, message: `Missing required column: ${col}` })),
      rows: [],
    };
  }

  const rows: CsvCatalogRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]!);
    const rowRecord: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowRecord[header] = (cells[index] ?? '').trim();
    });
    const parsed = parseRow(rowRecord, headers, i + 1);
    errors.push(...parsed.errors);
    if (parsed.row) rows.push(parsed.row);
  }

  return {
    valid: errors.length === 0,
    requiredColumns: REQUIRED_COLUMNS,
    missingColumns: [],
    rowCount: lines.length - 1,
    validRowCount: rows.length,
    errors,
    rows,
  };
}
