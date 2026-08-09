export type CatalogEntity = { id: string; kind: 'product' | 'recipe' | 'exercise'; name: string };
export type OwnerRole = 'OWNER' | 'ADMIN' | 'USER'; export type AIToggle = { enabled: boolean; updatedBy: string };
export type FeatureFlag = { key: string; enabled: boolean; updatedAt: string };
