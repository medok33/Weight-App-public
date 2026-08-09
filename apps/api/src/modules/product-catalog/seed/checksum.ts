import { createHash } from 'node:crypto';
import type { CatalogSeedManifest, ProductSeedRecord } from './seed.types';

/** Stable JSON for checksum: sorted object keys, products in author order. */
export function canonicalizeForChecksum(products: ProductSeedRecord[]): string {
  return JSON.stringify(products, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}

export function computeProductsChecksum(products: ProductSeedRecord[]): string {
  return createHash('sha256').update(canonicalizeForChecksum(products), 'utf8').digest('hex');
}

export function withComputedChecksum(
  manifest: Omit<CatalogSeedManifest, 'checksum' | 'productCount'> & {
    products: ProductSeedRecord[];
    checksum?: string;
  },
): CatalogSeedManifest {
  const checksum = computeProductsChecksum(manifest.products);
  return {
    ...manifest,
    productCount: manifest.products.length,
    checksum,
  };
}
