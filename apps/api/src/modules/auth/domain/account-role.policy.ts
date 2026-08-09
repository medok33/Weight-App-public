import type { AccountRole } from '../decorators/roles.decorator';

/** Higher number = broader system authority. OWNER is supreme. */
export const ACCOUNT_ROLE_RANK: Record<AccountRole, number> = {
  USER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function normalizeAccountRole(role: string | null | undefined): AccountRole | null {
  const normalized = String(role ?? '').trim().toUpperCase();
  if (normalized === 'USER' || normalized === 'ADMIN' || normalized === 'OWNER') return normalized;
  return null;
}

/**
 * Hierarchical authorization:
 * - OWNER satisfies USER, ADMIN, and OWNER requirements.
 * - ADMIN satisfies USER and ADMIN requirements (not OWNER-only).
 * - USER satisfies only USER requirements.
 *
 * MFA / recent reauth are assurance controls and must not be encoded here.
 */
export function roleSatisfies(actorRole: string | null | undefined, allowed: readonly AccountRole[]): boolean {
  if (!allowed.length) return true;
  const actor = normalizeAccountRole(actorRole);
  if (!actor) return false;
  const actorRank = ACCOUNT_ROLE_RANK[actor];
  return allowed.some((required) => actorRank >= ACCOUNT_ROLE_RANK[required]);
}

export function hasOwnerAuthority(role: string | null | undefined): boolean {
  return roleSatisfies(role, ['OWNER']);
}

export function hasAdminAuthority(role: string | null | undefined): boolean {
  return roleSatisfies(role, ['ADMIN']);
}

export function hasUserAuthority(role: string | null | undefined): boolean {
  return roleSatisfies(role, ['USER']);
}
