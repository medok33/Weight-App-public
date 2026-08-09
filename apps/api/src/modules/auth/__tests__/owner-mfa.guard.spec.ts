import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OwnerMfaGuard } from '../guards/owner-mfa.guard';
import { RecentOwnerReauthGuard } from '../guards/recent-owner-reauth.guard';
import { RequireRecentOwnerReauth } from '../decorators/require-recent-owner-reauth.decorator';
import { Reflector } from '@nestjs/core';

describe('OwnerMfaGuard staff session gate (TOTP not required)', () => {
  it('rejects missing session', async () => {
    const guard = new OwnerMfaGuard();
    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects USER session', async () => {
    const guard = new OwnerMfaGuard();
    await expect(
      guard.canActivate(contextFor({ id: 'u1', role: 'USER', mfaVerifiedAt: new Date() })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ADMIN without TOTP', async () => {
    const guard = new OwnerMfaGuard();
    await expect(guard.canActivate(contextFor({ id: 'a1', role: 'ADMIN' }))).resolves.toBe(true);
  });

  it('allows OWNER without mfaVerifiedAt (password session is enough)', async () => {
    const guard = new OwnerMfaGuard();
    await expect(
      guard.canActivate(contextFor({ id: 'owner-1', role: 'OWNER', mfaVerifiedAt: null })),
    ).resolves.toBe(true);
  });

  it('allows OWNER with legacy mfaVerifiedAt still set', async () => {
    const guard = new OwnerMfaGuard();
    await expect(
      guard.canActivate(contextFor({ id: 'owner-1', role: 'OWNER', mfaVerifiedAt: new Date() })),
    ).resolves.toBe(true);
  });
});

describe('RecentOwnerReauthGuard password reauth matrix', () => {
  it('rejects no/USER/ADMIN/stale and accepts recent OWNER password reauth', async () => {
    class Target {
      @RequireRecentOwnerReauth({ maxAgeSeconds: 300 })
      handler() {
        return true;
      }
    }
    const target = new Target();
    const reflector = new Reflector();
    const guard = new RecentOwnerReauthGuard(reflector);

    await expect(guard.canActivate(reauthContext(target.handler, undefined))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(reauthContext(target.handler, { id: 'u', role: 'USER', recentOwnerReauthAt: new Date() })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(reauthContext(target.handler, { id: 'a', role: 'ADMIN', recentOwnerReauthAt: new Date() })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        reauthContext(target.handler, {
          id: 'owner-1',
          role: 'OWNER',
          mfaVerifiedAt: null,
          recentOwnerReauthAt: new Date(Date.now() - 301_000),
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        reauthContext(target.handler, {
          id: 'owner-1',
          role: 'OWNER',
          mfaVerifiedAt: null,
          recentOwnerReauthAt: new Date(),
        }),
      ),
    ).resolves.toBe(true);
  });
});

function contextFor(user: Record<string, unknown> | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user,
      }),
    }),
  } as never;
}

function reauthContext(handler: () => unknown, user: Record<string, unknown> | undefined) {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({
        user: user ? { email: null, username: 'x', ...user } : undefined,
      }),
    }),
  } as never;
}
