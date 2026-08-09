import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  buildSessionCookie,
  clearSessionCookie,
  getSessionCookieName,
  readSessionTokenFromCookieHeader,
} from '../domain/session-cookie';
import {
  assertBrowserSecurityConfigAtStartup,
  resetBrowserSecurityConfigCache,
} from '../domain/browser-security.config';
import { CsrfOriginGuard, CSRF_ORIGIN_REJECTED } from '../guards/csrf-origin.guard';
import { CSRF_EXEMPT_KEY } from '../decorators/csrf-exempt.decorator';

function withEnv(env: Record<string, string | undefined>) {
  const keys = Object.keys(env);
  const previous: Record<string, string | undefined> = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetBrowserSecurityConfigCache();
  };
}

describe('ARCH-SEC-02A browser security config', () => {
  afterEach(() => {
    resetBrowserSecurityConfigCache();
  });

  it('fails closed for wildcard CORS with credentials-equivalent config', () => {
    const restore = withEnv({
      APP_ENV: 'PRODUCTION',
      WEB_ALLOWED_ORIGINS: '*',
      SESSION_COOKIE_SECURE: undefined,
    });
    try {
      expect(() => assertBrowserSecurityConfigAtStartup(process.env)).toThrow(/Wildcard|invalid/i);
    } finally {
      restore();
    }
  });

  it('fails closed when Secure=false in production', () => {
    const restore = withEnv({
      APP_ENV: 'PRODUCTION',
      WEB_ALLOWED_ORIGINS: 'https://app.example.com',
      SESSION_COOKIE_SECURE: 'false',
    });
    try {
      expect(() => assertBrowserSecurityConfigAtStartup(process.env)).toThrow(/Secure/i);
    } finally {
      restore();
    }
  });

  it('loads production allowlist and secure cookie', () => {
    const restore = withEnv({
      APP_ENV: 'PRODUCTION',
      WEB_ALLOWED_ORIGINS: ' https://app.example.com/ ',
      SESSION_COOKIE_SECURE: undefined,
    });
    try {
      const config = assertBrowserSecurityConfigAtStartup(process.env);
      expect(config.allowedOrigins).toEqual(['https://app.example.com']);
      expect(config.cookie.secure).toBe(true);
      expect(config.cookie.name).toBe('wa_session_prod');
    } finally {
      restore();
    }
  });

  it('clear cookie mirrors set-cookie policy attributes', () => {
    const restore = withEnv({
      APP_ENV: 'STAGING',
      WEB_ALLOWED_ORIGINS: 'https://staging.example.com',
      SESSION_COOKIE_DOMAIN: 'staging.example.com',
      SESSION_COOKIE_SECURE: undefined,
    });
    try {
      const config = assertBrowserSecurityConfigAtStartup(process.env);
      const set = buildSessionCookie('tok', config.cookie.maxAgeSeconds, config);
      const clear = clearSessionCookie(config);
      expect(set).toContain(`${config.cookie.name}=`);
      expect(clear).toContain(`${config.cookie.name}=`);
      expect(clear).toContain('HttpOnly');
      expect(clear).toContain('Path=/');
      expect(clear).toContain('SameSite=Lax');
      expect(clear).toContain('Secure');
      expect(clear).toContain('Domain=staging.example.com');
      expect(clear).toContain('Max-Age=0');
      expect(getSessionCookieName(config)).toBe('wa_session_staging');
    } finally {
      restore();
    }
  });
});

describe('ARCH-SEC-02A CsrfOriginGuard', () => {
  let restore: () => void;
  let guard: CsrfOriginGuard;
  let reflector: Reflector;

  beforeEach(() => {
    restore = withEnv({
      APP_ENV: 'LOCAL',
      WEB_ALLOWED_ORIGINS: 'http://localhost:3000',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_COOKIE_DOMAIN: undefined,
    });
    assertBrowserSecurityConfigAtStartup(process.env);
    reflector = new Reflector();
    guard = new CsrfOriginGuard(reflector);
  });

  afterEach(() => {
    restore();
  });

  function ctx(req: Record<string, unknown>, exempt = false) {
    const handler = () => undefined;
    if (exempt) {
      Reflect.defineMetadata(
        CSRF_EXEMPT_KEY,
        {
          reason: 'test webhook',
          trustMechanism: 'signature',
        },
        handler,
      );
    }
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => handler,
      getClass: () => class Test {},
    } as never;
  }

  it('allows GET without Origin', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'GET',
          headers: { cookie: 'wa_session_local=abc' },
          originalUrl: '/api/v1/auth/me',
        }),
      ),
    ).toBe(true);
  });

  it('rejects cookie-auth POST without Origin/Referer', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: { cookie: 'wa_session_local=abc' },
          originalUrl: '/api/v1/integrations/consents/grant',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects cookie-auth PATCH with foreign Origin', () => {
    try {
      guard.canActivate(
        ctx({
          method: 'PATCH',
          headers: {
            cookie: 'wa_session_local=abc',
            origin: 'https://evil.example',
          },
          originalUrl: '/api/v1/admin/products/x',
        }),
      );
      throw new Error('expected reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as { code?: string };
      expect(body.code).toBe(CSRF_ORIGIN_REJECTED);
    }
  });

  it('rejects similar hostname Origin', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'DELETE',
          headers: {
            cookie: 'wa_session_local=abc',
            origin: 'http://localhost:3000.evil.test',
          },
          originalUrl: '/api/v1/admin/products/x',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects malformed Origin', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: {
            cookie: 'wa_session_local=abc',
            origin: 'not a url',
          },
          originalUrl: '/api/v1/auth/logout',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows allowed Origin and Referer fallback', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: {
            cookie: 'wa_session_local=abc',
            origin: 'http://localhost:3000',
          },
          originalUrl: '/api/v1/auth/logout',
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: {
            cookie: 'wa_session_local=abc',
            referer: 'http://localhost:3000/settings',
          },
          originalUrl: '/api/v1/auth/logout',
        }),
      ),
    ).toBe(true);
  });

  it('allows header-only mutation without cookie (BFF / server-to-server)', () => {
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: { 'x-session-token': 'tok' },
          originalUrl: '/api/v1/admin/recipe-sources',
        }),
      ),
    ).toBe(true);
  });

  it('requires Origin for public login (cookie-issuing)', () => {
    expect(() =>
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: {},
          originalUrl: '/api/v1/auth/login',
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        ctx({
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          originalUrl: '/api/v1/auth/login',
        }),
      ),
    ).toBe(true);
  });

  it('allows documented webhook exemption without Origin', () => {
    expect(
      guard.canActivate(
        ctx(
          {
            method: 'POST',
            headers: {},
            originalUrl: '/api/v1/payments/webhook',
          },
          true,
        ),
      ),
    ).toBe(true);
  });

  it('reads env-specific cookie name', () => {
    const token = readSessionTokenFromCookieHeader('wa_session_local=secret; Path=/');
    expect(token).toBe('secret');
  });
});
