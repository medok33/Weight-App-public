export type OwnerOverviewMetrics = {
  users: number;
  activeSessions: number;
  auditEvents: number;
};

export type OwnerOverview = {
  allowed: true;
  role: 'OWNER' | 'ADMIN';
  metrics: OwnerOverviewMetrics;
};

export type OwnerUserSearchResponse = {
  items: Array<{ id: string; email: string; createdAt: string }>;
  total: number;
};
export type OwnerCatalogItem = { id: string; canonicalName: string; unit: string; caloriesPer100g: number; proteinPer100g: number };
export type OwnerCatalogResponse = { items: OwnerCatalogItem[] };
