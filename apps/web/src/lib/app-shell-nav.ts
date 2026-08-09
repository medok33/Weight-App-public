import { hasAdminCapabilities, isOwnerRole } from './auth';

export type AppShellNavModel = {
  showAdminEntry: boolean;
  showAdminWorkspaceNav: boolean;
  showOwnerOnlyLinks: boolean;
  showOwnerBadge: boolean;
};

/**
 * Centralized AppShell visibility from hierarchical role helpers.
 * Never introduce a bare `admin` local or exact-role allowlists here.
 */
export function resolveAppShellNav(
  role: string | null | undefined,
  pathname: string,
): AppShellNavModel {
  const adminCapable = hasAdminCapabilities(role);
  const owner = isOwnerRole(role);
  const adminWorkspace =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/owner-admin') ||
    pathname.startsWith('/observability') ||
    pathname.startsWith('/price-intelligence') ||
    pathname.startsWith('/owner/');

  return {
    showAdminEntry: adminCapable && !adminWorkspace,
    showAdminWorkspaceNav: Boolean(adminWorkspace && adminCapable),
    showOwnerOnlyLinks: owner,
    showOwnerBadge: owner,
  };
}
