import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthRepository } from '../infrastructure/auth.repository';
import { readSessionTokenFromCookieHeader } from '../domain/session-cookie';
import type { RequestUser } from '../domain/request-user.types';

@Injectable()
export class SessionAuthService {
  constructor(@Inject(AuthRepository) private readonly repository: AuthRepository) {}

  async resolveFromRequest(request: Request): Promise<RequestUser | null> {
    const rawToken =
      (request.headers['x-session-token'] as string | undefined) ??
      readSessionTokenFromCookieHeader(request.headers.cookie);
    if (!rawToken) return null;

    const session = await this.repository.resolveSession(rawToken);
    if (!session) return null;

    return {
      id: session.userId,
      email: session.email,
      username: session.username,
      role: session.role,
      mfaVerifiedAt: session.mfaVerifiedAt,
      recentOwnerReauthAt: session.recentOwnerReauthAt,
    };
  }

  async requireUser(request: Request): Promise<RequestUser> {
    const user = await this.resolveFromRequest(request);
    if (!user) throw new UnauthorizedException('AUTH_REQUIRED');
    return user;
  }
}
