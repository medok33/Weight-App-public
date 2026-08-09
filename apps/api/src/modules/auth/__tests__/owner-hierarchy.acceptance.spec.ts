import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Roles } from '../decorators/roles.decorator';
import { RequireRecentOwnerReauth } from '../decorators/require-recent-owner-reauth.decorator';
import {
  hasAdminAuthority,
  hasOwnerAuthority,
  hasUserAuthority,
  roleSatisfies,
} from '../domain/account-role.policy';
import { RolesGuard } from '../guards/roles.guard';
import { OwnerMfaGuard } from '../guards/owner-mfa.guard';
import { RecentOwnerReauthGuard } from '../guards/recent-owner-reauth.guard';

describe('OWNER supreme hierarchy policy', () => {
  it('OWNER supersedes ADMIN and USER; ADMIN does not inherit OWNER-only', () => {
    expect(roleSatisfies('OWNER', ['USER'])).toBe(true);
    expect(roleSatisfies('OWNER', ['ADMIN'])).toBe(true);
    expect(roleSatisfies('OWNER', ['OWNER'])).toBe(true);
    expect(roleSatisfies('OWNER', ['ADMIN', 'OWNER'])).toBe(true);

    expect(roleSatisfies('ADMIN', ['USER'])).toBe(true);
    expect(roleSatisfies('ADMIN', ['ADMIN'])).toBe(true);
    expect(roleSatisfies('ADMIN', ['OWNER'])).toBe(false);

    expect(roleSatisfies('USER', ['USER'])).toBe(true);
    expect(roleSatisfies('USER', ['ADMIN'])).toBe(false);
    expect(roleSatisfies('USER', ['OWNER'])).toBe(false);

    expect(hasUserAuthority('OWNER')).toBe(true);
    expect(hasAdminAuthority('OWNER')).toBe(true);
    expect(hasOwnerAuthority('OWNER')).toBe(true);
    expect(hasOwnerAuthority('ADMIN')).toBe(false);
  });

  it('RolesGuard accepts OWNER on ADMIN-only and USER-only routes and rejects ADMIN on OWNER-only', async () => {
    class Target {
      @Roles('ADMIN')
      adminOnly() {
        return true;
      }
      @Roles('USER')
      userOnly() {
        return true;
      }
      @Roles('OWNER')
      ownerOnly() {
        return true;
      }
    }
    const target = new Target();
    const guard = new RolesGuard(new Reflector());

    expect(guard.canActivate(roleContext(target.adminOnly, 'OWNER'))).toBe(true);
    expect(guard.canActivate(roleContext(target.userOnly, 'OWNER'))).toBe(true);
    expect(guard.canActivate(roleContext(target.ownerOnly, 'OWNER'))).toBe(true);
    expect(guard.canActivate(roleContext(target.adminOnly, 'ADMIN'))).toBe(true);
    expect(() => guard.canActivate(roleContext(target.ownerOnly, 'ADMIN'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(roleContext(target.adminOnly, 'USER'))).toThrow(ForbiddenException);
  });

  it('no controller @Roles allowlist omits hierarchical OWNER coverage', () => {
    const root = findApiSrc();
    const controllers = walk(join(root, 'modules')).filter((p) => p.endsWith('.controller.ts'));
    expect(controllers.length).toBeGreaterThan(10);

    const missingOwnerCoverage: string[] = [];
    for (const file of controllers) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('@Roles(')) continue;
      const roles = [...text.matchAll(/@Roles\(([^)]*)\)/g)].map((m) => m[1]);
      for (const raw of roles) {
        const allowed = [...raw.matchAll(/'([A-Z]+)'/g)].map((m) => m[1] as 'USER' | 'ADMIN' | 'OWNER');
        if (!allowed.length) continue;
        if (!roleSatisfies('OWNER', allowed)) {
          missingOwnerCoverage.push(`${relative(root, file)} :: @Roles(${raw})`);
        }
      }
    }
    expect(missingOwnerCoverage).toEqual([]);
  });

  it('staff gate and password reauth do not shrink OWNER role authority', async () => {
    expect(roleSatisfies('OWNER', ['ADMIN'])).toBe(true);
    expect(hasAdminAuthority('OWNER')).toBe(true);

    const staffGate = new OwnerMfaGuard();
    await expect(
      staffGate.canActivate(simpleUserContext({ id: 'o1', role: 'OWNER', mfaVerifiedAt: null })),
    ).resolves.toBe(true);
    await expect(
      staffGate.canActivate(simpleUserContext({ id: 'o1', role: 'OWNER', mfaVerifiedAt: new Date() })),
    ).resolves.toBe(true);

    class Target {
      @RequireRecentOwnerReauth({ maxAgeSeconds: 300 })
      critical() {
        return true;
      }
    }
    const target = new Target();
    const reauth = new RecentOwnerReauthGuard(new Reflector());
    await expect(
      reauth.canActivate(
        reauthContext(target.critical, {
          id: 'o1',
          role: 'OWNER',
          mfaVerifiedAt: null,
          recentOwnerReauthAt: new Date(Date.now() - 301_000),
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      reauth.canActivate(
        reauthContext(target.critical, {
          id: 'o1',
          role: 'OWNER',
          mfaVerifiedAt: null,
          recentOwnerReauthAt: new Date(),
        }),
      ),
    ).resolves.toBe(true);

    // After password reauth is satisfied, RolesGuard still grants full OWNER hierarchy.
    const rolesGuard = new RolesGuard(new Reflector());
    class AdminTarget {
      @Roles('ADMIN')
      handler() {
        return true;
      }
    }
    expect(rolesGuard.canActivate(roleContext(new AdminTarget().handler, 'OWNER'))).toBe(true);
  });
});

function roleContext(handler: () => unknown, role: string) {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', email: null, username: null, role } }),
    }),
  } as never;
}

function simpleUserContext(user: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function reauthContext(handler: () => unknown, user: Record<string, unknown>) {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function findApiSrc(): string {
  const candidates = [join(process.cwd(), 'src'), join(process.cwd(), 'apps/api/src')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('API_SRC_NOT_FOUND');
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}
