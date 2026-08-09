import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  REQUIRE_RECENT_OWNER_REAUTH_KEY,
  type RequireRecentOwnerReauthOptions,
} from '../decorators/require-recent-owner-reauth.decorator';
import type { RequestUser } from '../domain/request-user.types';

/**
 * Critical OWNER actions require recent password reauthentication.
 * TOTP MFA is not part of this gate.
 */
@Injectable()
export class RecentOwnerReauthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RequireRecentOwnerReauthOptions | undefined>(
      REQUIRE_RECENT_OWNER_REAUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user?.id || String(user.role).toUpperCase() !== 'OWNER') throw recentReauthRequired();

    const maxAgeSeconds = options.maxAgeSeconds ?? 300;
    const reauthAt = user.recentOwnerReauthAt ? new Date(user.recentOwnerReauthAt).getTime() : 0;
    if (!reauthAt || Date.now() - reauthAt > maxAgeSeconds * 1000) {
      throw recentReauthRequired();
    }
    return true;
  }
}

function recentReauthRequired(): ForbiddenException {
  return new ForbiddenException({
    error: { code: 'RECENT_REAUTH_REQUIRED', message: 'Recent owner reauthentication is required.' },
  });
}
