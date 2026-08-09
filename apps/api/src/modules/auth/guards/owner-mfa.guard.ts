import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from '../domain/request-user.types';

/**
 * Staff gate for OWNER/ADMIN routes.
 * Product policy: TOTP MFA is not required. Authenticated OWNER/ADMIN session is enough.
 * Destructive actions use RecentOwnerReauthGuard (password reauth) instead.
 */
@Injectable()
export class OwnerMfaGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user?.id) throw staffRequired();
    const role = String(user.role).toUpperCase();
    if (role === 'OWNER' || role === 'ADMIN') return true;
    throw staffRequired();
  }
}

function staffRequired(): ForbiddenException {
  return new ForbiddenException({
    error: { code: 'OWNER_ACCESS_FORBIDDEN', message: 'Owner access forbidden.' },
  });
}
