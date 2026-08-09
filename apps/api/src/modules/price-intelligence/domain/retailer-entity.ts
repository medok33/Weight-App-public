/**
 * Canonical retailer record for Price Intelligence Engine.
 * Business logic uses `code` (MAGNIT, PYATEROCHKA, …) — never display `name`.
 */
export type RetailerEntity = {
  id: string;
  name: string;
  code: string;
  region: string;
  active: boolean;
};

/**
 * Normalized grocery product — never store "Куриная грудка Магнит" as identity.
 */
export type NormalizedProduct = {
  id: string;
  productKey: string;
  name: string;
  category: string;
  unit: string;
  weight?: string;
};

export const KNOWN_RETAILER_CODES = [
  'MAGNIT',
  'PYATEROCHKA',
  'VKUSVILL',
  'X5',
  'AZBUKA_VKUSA',
] as const;

export type KnownRetailerCode = (typeof KNOWN_RETAILER_CODES)[number];

export function normalizeRetailerCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'UNKNOWN';
}
