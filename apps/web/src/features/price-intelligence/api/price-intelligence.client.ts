import type {
  AdminMeta,
  CreateProductInput,
  CsvValidationResult,
  ImportReport,
  ObservationAdminView,
  PriceReview,
  ProductAdminView,
  RetailerAdminView,
} from '../model/price-intelligence.types';

export type IngestResult = ImportReport;

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init });
  if (response.status === 401 || response.status === 403) throw new Error('PRICE_ACCESS_FORBIDDEN');
  if (!response.ok) throw new Error('PRICE_ADMIN_FAILED');
  return response.json() as Promise<T>;
}

export async function getPriceReview(): Promise<PriceReview> {
  return adminFetch<PriceReview>('/api/price-intelligence/review');
}

export async function importPrices(csv: string) {
  const response = await fetch('/api/price-intelligence/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('PRICE_IMPORT_FAILED');
  return response.json() as Promise<{ imported: number }>;
}

export async function importOpenData(format: 'csv' | 'json' | 'xml' | 'xlsx' | 'tsv', payload: string, sourceName?: string) {
  const response = await fetch('/api/price-intelligence/sources/open-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format, payload, sourceName }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('PRICE_IMPORT_FAILED');
  return response.json() as Promise<ImportReport>;
}

export async function importManualCsv(csv: string, sourceName?: string) {
  const response = await fetch('/api/price-intelligence/sources/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv, sourceName }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('PRICE_IMPORT_FAILED');
  return response.json() as Promise<ImportReport>;
}

export async function syncMockApi(sourceName?: string) {
  const response = await fetch('/api/price-intelligence/sources/mock-api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceName }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('PRICE_SYNC_FAILED');
  return response.json() as Promise<ImportReport>;
}

export async function validateCatalogCsv(payload: string): Promise<CsvValidationResult> {
  const response = await fetch('/api/price-intelligence/sources/catalog-csv/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('PRICE_VALIDATE_FAILED');
  return response.json() as Promise<CsvValidationResult>;
}

export async function importCatalogCsv(payload: string, sourceName?: string, retailerCode?: string): Promise<ImportReport> {
  const response = await fetch('/api/price-intelligence/sources/catalog-csv', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload, sourceName, retailerCode }),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('PRICE_IMPORT_FAILED');
  return response.json() as Promise<ImportReport>;
}

export async function getAdminMeta(): Promise<AdminMeta> {
  return adminFetch<AdminMeta>('/api/price-intelligence/admin/meta');
}

export async function listRetailers(): Promise<{ items: RetailerAdminView[] }> {
  return adminFetch('/api/price-intelligence/admin/retailers');
}

export async function updateRetailer(id: string, input: { name?: string; region?: string; active?: boolean }) {
  return adminFetch<RetailerAdminView>(`/api/price-intelligence/admin/retailers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function listProducts(): Promise<{ items: ProductAdminView[] }> {
  return adminFetch('/api/price-intelligence/admin/products');
}

export async function createProduct(input: CreateProductInput): Promise<ProductAdminView> {
  return adminFetch('/api/price-intelligence/admin/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateProduct(id: string, input: Partial<CreateProductInput>): Promise<ProductAdminView> {
  return adminFetch(`/api/price-intelligence/admin/products/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function listObservations(filters?: {
  productId?: string;
  retailerId?: string;
  sourceType?: string;
}): Promise<{ items: ObservationAdminView[] }> {
  const params = new URLSearchParams();
  if (filters?.productId) params.set('productId', filters.productId);
  if (filters?.retailerId) params.set('retailerId', filters.retailerId);
  if (filters?.sourceType) params.set('sourceType', filters.sourceType);
  const query = params.toString();
  return adminFetch(`/api/price-intelligence/admin/observations${query ? `?${query}` : ''}`);
}
