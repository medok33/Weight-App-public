import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { browserMutationOriginAllowed } from '../domain/browser-security.policy';
import { CSRF_EXEMPT_KEY, type CsrfExemptMeta } from '../decorators/csrf-exempt.decorator';
import { getBrowserSecurityConfig } from '../domain/browser-security.config';
import { readSessionTokenFromCookieHeader } from '../domain/session-cookie';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const COOKIE_ISSUING_PATHS = [/\/auth\/login\/?$/i, /\/auth\/register\/?$/i];

export const CSRF_ORIGIN_REJECTED = 'CSRF_ORIGIN_REJECTED';

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = String(request.method ?? 'GET').toUpperCase();
    if (!UNSAFE_METHODS.has(method)) return true;

    const exempt = this.reflector.getAllAndOverride<CsrfExemptMeta | undefined>(CSRF_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const config = getBrowserSecurityConfig();
    const cookieHeader = request.headers.cookie;
    const hasSessionCookie = Boolean(readSessionTokenFromCookieHeader(cookieHeader, config));
    const path = String(request.originalUrl ?? request.url ?? '');
    const isCookieIssuingAuth = COOKIE_ISSUING_PATHS.some((pattern) => pattern.test(path));

    // Header-only / server-to-server callers without a session cookie are not CSRF-browser vectors.
    if (!hasSessionCookie && !isCookieIssuingAuth) return true;

    const origin = headerValue(request.headers.origin);
    const referer = headerValue(request.headers.referer);
    const allowed = browserMutationOriginAllowed({
      origin,
      referer,
      allowedOrigins: config.allowedOrigins,
    });
    if (!allowed) {
      const requestId = headerValue(request.headers['x-request-id']) ?? headerValue(request.headers['x-correlation-id']);
      throw new ForbiddenException({
        code: CSRF_ORIGIN_REJECTED,
        message: 'Origin check failed',
        ...(requestId ? { requestId } : {}),
      });
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
