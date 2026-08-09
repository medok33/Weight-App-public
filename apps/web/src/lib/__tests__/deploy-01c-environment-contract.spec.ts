import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadBrowserSecurityConfig,
  sessionCookieNameForEnv,
} from '../browser-security';

describe('DEPLOY-01C environment cookie contract', () => {
  const root = resolve(__dirname, '../../../../..');

  it('uses distinct session cookie names per APP_ENV', () => {
    expect(sessionCookieNameForEnv('LOCAL')).toBe('wa_session_local');
    expect(sessionCookieNameForEnv('STAGING')).toBe('wa_session_staging');
    expect(sessionCookieNameForEnv('PRODUCTION')).toBe('wa_session_prod');
  });

  it('keeps LOCAL cookie insecure on HTTP localhost', () => {
    const local = loadBrowserSecurityConfig({ APP_ENV: 'LOCAL', NODE_ENV: 'development' });
    expect(local.cookie.secure).toBe(false);
    expect(local.cookie.name).toBe('wa_session_local');
  });

  it('requires Secure cookie for PRODUCTION HTTPS origins', () => {
    const prod = loadBrowserSecurityConfig({
      NODE_ENV: 'production',
      APP_ENV: 'PRODUCTION',
      WEB_ALLOWED_ORIGINS: 'https://app.example.com',
    });
    expect(prod.cookie.secure).toBe(true);
    expect(prod.cookie.name).toBe('wa_session_prod');
  });

  it('documents separate compose project names', () => {
    const local = readFileSync(resolve(root, 'docker/compose.local.yaml'), 'utf8');
    const staging = readFileSync(resolve(root, 'docker/compose.staging.yaml'), 'utf8');
    const production = readFileSync(resolve(root, 'docker/compose.production.yaml'), 'utf8');
    expect(local).toContain('weight-app-local');
    expect(staging).toContain('weight-app-staging');
    expect(production).toContain('weight-app-production');
  });

  it('keeps INTERNAL_API_BASE_URL out of NEXT_PUBLIC env templates', () => {
    for (const file of ['local.env.example', 'staging.env.example', 'production.env.example']) {
      const body = readFileSync(resolve(root, 'docker/env', file), 'utf8');
      expect(body).toContain('INTERNAL_API_BASE_URL=');
      expect(body).not.toMatch(/NEXT_PUBLIC_INTERNAL_API/);
    }
  });

  it('does not auto-migrate in API image CMD', () => {
    const dockerfile = readFileSync(resolve(root, 'docker/Dockerfile.api'), 'utf8');
    expect(dockerfile).toMatch(/AS api[\s\S]*CMD \["node", "dist\/main\.js"\]/);
    expect(dockerfile).toMatch(/AS migrate[\s\S]*migrate\.mjs/);
  });
});
