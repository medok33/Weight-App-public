import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RequireRecentOwnerReauth } from '../decorators/require-recent-owner-reauth.decorator';
import { RecentOwnerReauthGuard } from '../guards/recent-owner-reauth.guard';

describe('RecentOwnerReauthGuard', () => {
  it('rejects stale or client-claimed owner reauth and accepts server session assurance', async () => {
    class Target {
      @RequireRecentOwnerReauth({ maxAgeSeconds: 300 })
      handler() {
        return true;
      }
    }
    const target = new Target();
    const reflector = new Reflector();
    const guard = new RecentOwnerReauthGuard(reflector);

    await expect(guard.canActivate(contextFor(target.handler, { role: 'OWNER', mfaVerifiedAt: new Date(), recentOwnerReauthAt: new Date(Date.now() - 301_000) }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextFor(target.handler, { role: 'USER', mfaVerifiedAt: new Date(), recentOwnerReauthAt: new Date() }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextFor(target.handler, { role: 'OWNER', mfaVerifiedAt: new Date(), recentOwnerReauthAt: new Date() }))).resolves.toBe(true);
  });
});

function contextFor(handler: () => unknown, user: Record<string, unknown>) {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-owner-reauth-at': new Date().toISOString() },
        user: { id: 'owner-1', email: null, username: 'owner', ...user },
      }),
    }),
  } as never;
}
