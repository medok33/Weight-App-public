export type OwnerAccess = { allowed: boolean; role: 'OWNER' | 'ADMIN' };
import type { OwnerCatalogResponse, OwnerOverview } from '../model/owner-admin.types';
import type { OwnerUserSearchResponse } from '../model/owner-admin.types';

export async function getOwnerAccess(): Promise<OwnerAccess> {
  const response = await fetch('/api/owner-admin/access', { credentials: 'include', cache: 'no-store' });
  if (response.status === 401 || response.status === 403) throw new Error('OWNER_ACCESS_FORBIDDEN');
  if (!response.ok) throw new Error('OWNER_ACCESS_FAILED');
  return response.json() as Promise<OwnerAccess>;
}

export async function getOwnerOverview(): Promise<OwnerOverview> {
  const response = await fetch('/api/owner-admin/overview', { credentials: 'include', cache: 'no-store' });
  if (response.status === 401 || response.status === 403) throw new Error('OWNER_ACCESS_FORBIDDEN');
  if (!response.ok) throw new Error('OWNER_OVERVIEW_FAILED');
  return response.json() as Promise<OwnerOverview>;
}

export async function searchOwnerUsers(query: string): Promise<OwnerUserSearchResponse> {
  const response = await fetch(`/api/owner-admin/users?q=${encodeURIComponent(query)}`, { credentials: 'include', cache: 'no-store' });
  if (response.status === 401 || response.status === 403) throw new Error('OWNER_ACCESS_FORBIDDEN');
  if (response.status === 400) throw new Error('OWNER_USER_QUERY_INVALID');
  if (!response.ok) throw new Error('OWNER_USER_SEARCH_FAILED');
  return response.json() as Promise<OwnerUserSearchResponse>;
}
export async function getOwnerCatalog(): Promise<OwnerCatalogResponse> { const response = await fetch('/api/owner-admin/catalog', { credentials: 'include', cache: 'no-store' }); if (response.status === 401 || response.status === 403) throw new Error('OWNER_ACCESS_FORBIDDEN'); if (!response.ok) throw new Error('OWNER_CATALOG_FAILED'); return response.json() as Promise<OwnerCatalogResponse>; }
