/** How a retailer participates in price/basket logic — never branch on display name. */
export const RETAILER_TYPES = ['CHAIN', 'DISCOUNTER', 'HYPERMARKET', 'LOCAL', 'ONLINE', 'OTHER'] as const;

export type RetailerType = (typeof RETAILER_TYPES)[number];

export type RetailerRef = {
  key: string;
  name: string;
  type: RetailerType;
};

export type RetailerRecord = RetailerRef & {
  id: string;
};

/** Stable slug for persistence — only used at ingest boundaries, not in domain rules. */
export function slugRetailerKey(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'unknown_retailer';
}

export function normalizeRetailerType(raw?: string): RetailerType {
  const value = (raw ?? 'CHAIN').trim().toUpperCase();
  return (RETAILER_TYPES as readonly string[]).includes(value) ? (value as RetailerType) : 'OTHER';
}

export function normalizeRetailerRef(input: { name: string; key?: string; type?: string }): RetailerRef {
  const name = input.name.trim();
  if (!name) throw new Error('RETAILER_NAME_REQUIRED');
  return {
    key: input.key?.trim() || slugRetailerKey(name),
    name,
    type: normalizeRetailerType(input.type),
  };
}
