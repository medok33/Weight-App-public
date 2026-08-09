import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RequireRecentOwnerReauth } from '../decorators/require-recent-owner-reauth.decorator';
import { RecentOwnerReauthGuard } from '../guards/recent-owner-reauth.guard';

describe('recentOwnerReauth server-only assurance', () => {
  it('client timestamps/headers/body cannot bypass; only server session recentOwnerReauthAt counts', async () => {
    class Target {
      @RequireRecentOwnerReauth({ maxAgeSeconds: 300 })
      handler() {
        return true;
      }
    }
    const target = new Target();
    const guard = new RecentOwnerReauthGuard(new Reflector());

    await expect(
      guard.canActivate({
        getHandler: () => target.handler,
        getClass: () => Object,
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-owner-reauth-at': new Date().toISOString() },
            body: { recentOwnerReauthAt: new Date().toISOString(), password: 'x', code: '123456' },
            cookies: { recentOwnerReauthAt: new Date().toISOString() },
            user: {
              id: 'owner-1',
              email: null,
              username: 'owner',
              role: 'OWNER',
              mfaVerifiedAt: null,
              recentOwnerReauthAt: null,
            },
          }),
        }),
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      guard.canActivate({
        getHandler: () => target.handler,
        getClass: () => Object,
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
            body: {},
            user: {
              id: 'owner-1',
              email: null,
              username: 'owner',
              role: 'OWNER',
              mfaVerifiedAt: null,
              recentOwnerReauthAt: new Date(),
            },
          }),
        }),
      } as never),
    ).resolves.toBe(true);
  });
});
