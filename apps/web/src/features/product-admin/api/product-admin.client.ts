async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP_${response.status}`;
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export function listAdminProducts(query: URLSearchParams) {
  return adminFetch<{ items: AdminProductListItem[]; total: number; page: number; pageSize: number }>(
    `/api/admin/products?${query.toString()}`,
  );
}

export function getAdminProduct(id: string) {
  return adminFetch<AdminProductDetail>(`/api/admin/products/${id}`);
}

export function getAdminProductMeta() {
  return adminFetch<AdminProductMeta>('/api/admin/products/meta');
}

export function createAdminProduct(body: Record<string, unknown>) {
  return adminFetch<{ id: string }>('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
}

export function updateAdminProduct(id: string, body: Record<string, unknown>) {
  return adminFetch<AdminProductDetail>(`/api/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function createNutritionVersion(id: string, body: Record<string, unknown>) {
  return adminFetch(`/api/admin/products/${id}/nutrition-versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function addAdminAlias(id: string, body: Record<string, unknown>) {
  return adminFetch(`/api/admin/products/${id}/aliases`, { method: 'POST', body: JSON.stringify(body) });
}

export function putAdminAllergens(id: string, items: unknown[]) {
  return adminFetch(`/api/admin/products/${id}/allergens`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

export function putAdminDietaryTags(id: string, items: unknown[]) {
  return adminFetch(`/api/admin/products/${id}/dietary-tags`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

export function putAdminCulinaryRoles(id: string, items: unknown[]) {
  return adminFetch(`/api/admin/products/${id}/culinary-roles`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

export function createAdminSubstitution(id: string, body: Record<string, unknown>) {
  return adminFetch(`/api/admin/products/${id}/substitutions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function mergePreview(id: string, targetProductId: string) {
  return adminFetch(`/api/admin/products/${id}/merge-preview`, {
    method: 'POST',
    body: JSON.stringify({ targetProductId }),
  });
}

export function mergeProducts(id: string, targetProductId: string) {
  return adminFetch(`/api/admin/products/${id}/merge`, {
    method: 'POST',
    body: JSON.stringify({ targetProductId }),
  });
}

export function listProductReview(filters?: {
  queue?: string;
  datasetVersion?: string;
  severity?: string;
  source?: string;
  category?: string;
  issueType?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.queue) params.set('queue', filters.queue);
  if (filters?.datasetVersion) params.set('datasetVersion', filters.datasetVersion);
  if (filters?.severity) params.set('severity', filters.severity);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.issueType) params.set('issueType', filters.issueType);
  const qs = params.toString();
  return adminFetch<{ items: AdminReviewItem[] }>(`/api/admin/product-review${qs ? `?${qs}` : ''}`);
}

export function postProductReview(id: string, body: Record<string, unknown>) {
  return adminFetch(`/api/admin/products/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listProductDuplicates() {
  return adminFetch<{ items: AdminDuplicateItem[] }>('/api/admin/product-duplicates');
}

export type AdminProductListItem = {
  id: string;
  canonicalName: string;
  productKey: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  form: string | null;
  seedDatasetVersion: string | null;
  nutritionStatus: string;
  aliasesCount: number;
  allergenStatus: string;
  dietaryTags: string[];
  culinaryRoles: string[];
  retailProductCount: number;
  priceCoverage: string;
  reviewStatus: string;
  status: string;
  updatedAt: string;
};

export type AdminProductDetail = {
  overview: Record<string, unknown> & {
    id: string;
    canonicalName: string;
    productKey: string | null;
    rowVersion: number;
    form: string | null;
    categoryId: string | null;
    reviewWarnings?: string[];
  };
  aliases: Array<Record<string, unknown>>;
  nutritionVersions: Array<Record<string, unknown>>;
  allergens: Array<Record<string, unknown>>;
  dietaryTags: Array<Record<string, unknown>>;
  culinaryRoles: Array<Record<string, unknown>>;
  substitutions: Array<Record<string, unknown>>;
  retailProducts: Array<Record<string, unknown>>;
  prices: Array<Record<string, unknown>>;
  auditHistory: Array<Record<string, unknown>>;
  futureRecipeRevalidationRequired?: boolean;
};

export type AdminProductMeta = {
  categories: Array<{ id: string; code: string; name: string }>;
  allergens: Array<{ id: string; code: string; name: string }>;
  dietaryTags: Array<{ id: string; code: string; name: string }>;
  culinaryRoles: Array<{ id: string; code: string; name: string }>;
  forms: string[];
  units: string[];
};

export type AdminReviewItem = {
  queueCode: string;
  productId: string;
  canonicalName: string;
  severity: string;
  source: string;
  detectedAt: string;
};

export type AdminDuplicateItem = {
  pair: Array<{ id: string; canonicalName: string }>;
  reasons: string[];
  confidence: number;
};
