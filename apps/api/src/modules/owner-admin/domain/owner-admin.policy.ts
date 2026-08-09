import type { CatalogEntity, OwnerRole, AIToggle } from './owner-admin.types';
import { hasAdminAuthority, hasOwnerAuthority } from '../../auth/domain/account-role.policy';

export function canManageCatalog(role: string) {
  return hasAdminAuthority(role);
}
export function validateCatalogEntity(entity: CatalogEntity) { if (!entity.id || !entity.name.trim()) throw new Error('CATALOG_ENTITY_INVALID'); return entity; }
export function toggleAI(current: AIToggle, enabled: boolean, role: OwnerRole) {
  if (!hasOwnerAuthority(role)) throw new Error('OWNER_REQUIRED');
  return { ...current, enabled };
}
/** Kept for compatibility; TOTP MFA is not required for OWNER/ADMIN access. */
export function requireMfa(role: OwnerRole, verified: boolean) {
  void role;
  void verified;
  return true;
}
export function maskSupportUser(email: string) { const [name, domain] = email.split('@'); return `${(name?.slice(0, 2) ?? '**')}***@${domain ?? 'hidden'}`; }
export function validateSupportAccess(reason: string, ttlMinutes: number) {
  const normalized = reason.trim();
  if (normalized.length < 5 || normalized.length > 500) throw new Error('SUPPORT_REASON_INVALID');
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 60) throw new Error('SUPPORT_TTL_INVALID');
  return { reason: normalized, ttlMinutes };
}
export function validateCatalogProduct(input: { canonicalName: string; unit: string; caloriesPer100g: number; proteinPer100g: number }) {
  const name = input.canonicalName.trim();
  if (!name || !['g', 'ml', 'piece'].includes(input.unit) || input.caloriesPer100g < 0 || input.proteinPer100g < 0) throw new Error('CATALOG_PRODUCT_INVALID');
  return { canonicalName: name, unit: input.unit, caloriesPer100g: input.caloriesPer100g, proteinPer100g: input.proteinPer100g };
}
export function validateFeatureFlagKey(key: string): string { const normalized = key.trim(); if (!/^[a-z][a-z0-9._-]{1,63}$/.test(normalized)) throw new Error('FEATURE_FLAG_KEY_INVALID'); return normalized; }

/** STEP_168: canonical closed-beta gate flag (OWNER FeatureFlag table). */
export const CLOSED_BETA_FLAG_KEY = 'closed_beta';

export function assertClosedBetaFlagKey(key: string): string {
  const normalized = validateFeatureFlagKey(key);
  if (normalized !== CLOSED_BETA_FLAG_KEY) throw new Error('CLOSED_BETA_FLAG_KEY_INVALID');
  return normalized;
}

export function isClosedBetaEnabled(flags: ReadonlyArray<{ key: string; enabled: boolean }>): boolean {
  return flags.some((f) => f.key === CLOSED_BETA_FLAG_KEY && f.enabled === true);
}
