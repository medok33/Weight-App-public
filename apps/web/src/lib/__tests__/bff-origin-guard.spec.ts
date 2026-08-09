import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  browserMutationOriginRejected,
  CSRF_ORIGIN_REJECTED,
  resetWebBrowserSecurityConfigCache,
} from '../session-proxy';

function withEnv(env: Record<string, string | undefined>) {
  const keys = Object.keys(env);
  const prev: Record<string, string | undefined> = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetWebBrowserSecurityConfigCache();
  return () => {
    for (const key of keys) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetWebBrowserSecurityConfigCache();
  };
}

describe('ARCH-SEC-02A Next.js BFF origin gate', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = withEnv({
      APP_ENV: 'LOCAL',
      WEB_ALLOWED_ORIGINS: 'http://localhost:3000',
    });
  });

  afterEach(() => restore());

  it('allows GET without Origin', () => {
    const req = new Request('http://localhost:3000/api/admin/recipe-sources', { method: 'GET' });
    expect(browserMutationOriginRejected(req)).toBeNull();
  });

  it('rejects POST without Origin/Referer before cookie conversion', async () => {
    const req = new Request('http://localhost:3000/api/payments/checkout', { method: 'POST' });
    const rejected = browserMutationOriginRejected(req);
    expect(rejected).toBeInstanceOf(Response);
    expect(rejected!.status).toBe(403);
    const body = await rejected!.json();
    expect(body.code).toBe(CSRF_ORIGIN_REJECTED);
  });

  it('rejects foreign Origin', async () => {
    const req = new Request('http://localhost:3000/api/admin/recipe-sources', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    const rejected = browserMutationOriginRejected(req);
    expect(rejected?.status).toBe(403);
  });

  it('rejects similar hostname', async () => {
    const req = new Request('http://localhost:3000/api/admin/recipe-sources', {
      method: 'DELETE',
      headers: { Origin: 'https://weight-app.ru.attacker.example' },
    });
    expect(browserMutationOriginRejected(req)?.status).toBe(403);
  });

  it('allows allowlisted Origin and Referer fallback', () => {
    expect(
      browserMutationOriginRejected(
        new Request('http://localhost:3000/api/payments/checkout', {
          method: 'POST',
          headers: { Origin: 'http://localhost:3000' },
        }),
      ),
    ).toBeNull();
    expect(
      browserMutationOriginRejected(
        new Request('http://localhost:3000/api/payments/checkout', {
          method: 'POST',
          headers: { Referer: 'http://localhost:3000/payments' },
        }),
      ),
    ).toBeNull();
  });

  it('rejects malformed Origin', async () => {
    const req = new Request('http://localhost:3000/api/payments/checkout', {
      method: 'PATCH',
      headers: { Origin: 'not-a-url' },
    });
    expect(browserMutationOriginRejected(req)?.status).toBe(403);
  });

  it('rejects cross-site OWNER MFA BFF POSTs before cookie/session forwarding (matrix 35/36)', async () => {
    const paths = [
      '/api/auth/owner-mfa/enroll/start',
      '/api/auth/owner-mfa/enroll/confirm',
      '/api/auth/mfa/challenge',
      '/api/auth/owner-mfa/reauth',
      '/api/auth/owner-mfa/recovery-codes/regenerate',
    ];
    for (const path of paths) {
      const rejected = browserMutationOriginRejected(
        new Request(`http://localhost:3000${path}`, {
          method: 'POST',
          headers: { Origin: 'https://evil.example', Cookie: 'wa_session_local=stolen' },
        }),
      );
      expect(rejected).toBeInstanceOf(Response);
      expect(rejected!.status).toBe(403);
      const body = await rejected!.json();
      expect(body.code).toBe(CSRF_ORIGIN_REJECTED);
    }
  });
});
