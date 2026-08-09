import { describe, expect, it } from 'vitest';
import { hasAdminCapabilities, isAdminRole, isOwnerRole, roleSatisfies } from '../auth';
import { resolveAppShellNav } from '../app-shell-nav';

describe('web OWNER hierarchy helpers', () => {
  it('OWNER has admin capabilities without becoming exact ADMIN', () => {
    expect(isOwnerRole('OWNER')).toBe(true);
    expect(isAdminRole('OWNER')).toBe(false);
    expect(hasAdminCapabilities('OWNER')).toBe(true);
    expect(hasAdminCapabilities('ADMIN')).toBe(true);
    expect(hasAdminCapabilities('USER')).toBe(false);
    expect(roleSatisfies('OWNER', ['ADMIN'])).toBe(true);
    expect(roleSatisfies('ADMIN', ['OWNER'])).toBe(false);
  });
});

describe('AppShell nav model USER / ADMIN / OWNER', () => {
  it('USER never receives administrative navigation', () => {
    const userHome = resolveAppShellNav('USER', '/dashboard-today');
    expect(userHome.showAdminEntry).toBe(false);
    expect(userHome.showAdminWorkspaceNav).toBe(false);
    expect(userHome.showOwnerOnlyLinks).toBe(false);
    expect(userHome.showOwnerBadge).toBe(false);

    const userAdminPath = resolveAppShellNav('USER', '/admin/content');
    expect(userAdminPath.showAdminWorkspaceNav).toBe(false);
    expect(userAdminPath.showOwnerOnlyLinks).toBe(false);
  });

  it('ADMIN receives ADMIN capabilities but not OWNER-only links', () => {
    const adminHome = resolveAppShellNav('ADMIN', '/dashboard-today');
    expect(adminHome.showAdminEntry).toBe(true);
    expect(adminHome.showOwnerOnlyLinks).toBe(false);
    expect(adminHome.showOwnerBadge).toBe(false);

    const adminWorkspace = resolveAppShellNav('ADMIN', '/admin/content');
    expect(adminWorkspace.showAdminWorkspaceNav).toBe(true);
    expect(adminWorkspace.showAdminEntry).toBe(false);
    expect(adminWorkspace.showOwnerOnlyLinks).toBe(false);
  });

  it('OWNER receives USER+ADMIN entry and OWNER-only capabilities', () => {
    const ownerHome = resolveAppShellNav('OWNER', '/dashboard-today');
    expect(ownerHome.showAdminEntry).toBe(true);
    expect(ownerHome.showOwnerOnlyLinks).toBe(true);
    expect(ownerHome.showOwnerBadge).toBe(true);

    const ownerWorkspace = resolveAppShellNav('OWNER', '/owner-admin');
    expect(ownerWorkspace.showAdminWorkspaceNav).toBe(true);
    expect(ownerWorkspace.showOwnerOnlyLinks).toBe(true);
    expect(ownerWorkspace.showOwnerBadge).toBe(true);
  });
});
