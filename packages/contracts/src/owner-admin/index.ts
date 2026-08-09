export type OwnerOverviewMetrics = {
  users: number;
  activeSessions: number;
  auditEvents: number;
};

export type OwnerOverviewResponse = {
  allowed: true;
  role: 'OWNER' | 'ADMIN';
  metrics: OwnerOverviewMetrics;
};
export type { OwnerUserSearchItem, OwnerUserSearchResponse } from './users';
