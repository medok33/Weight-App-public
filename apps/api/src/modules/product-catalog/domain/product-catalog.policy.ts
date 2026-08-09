import type { Product } from './product-catalog.types';
export function validateProduct(product: Product): Product { if (!product.canonicalName.trim() || !['g','ml','piece'].includes(product.unit) || product.caloriesPer100g < 0 || product.proteinPer100g < 0) throw new Error('PRODUCT_INVALID'); return { ...product, aliases: [...new Set((product.aliases ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))] }; }
export function canonicalizeAlias(alias: string): string { const value = alias.trim().toLowerCase(); if (!value) throw new Error('PRODUCT_ALIAS_INVALID'); return value; }
