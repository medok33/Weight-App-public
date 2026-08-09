import { describe, expect, it } from 'vitest';
import { internalApiBaseUrl } from '../auth-bff';

describe('internalApiBaseUrl (DEPLOY-01B / BUGFIX-PROFILE-SAVE-01)', () => {
  it('prefers INTERNAL_API_BASE_URL over localhost default', () => {
    const prevInternal = process.env.INTERNAL_API_BASE_URL;
    const prevApi = process.env.API_BASE_URL;
    const prevPublic = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.INTERNAL_API_BASE_URL = 'http://api:3001/api/v1/';
    delete process.env.API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
    expect(internalApiBaseUrl()).toBe('http://api:3001/api/v1');
    process.env.INTERNAL_API_BASE_URL = prevInternal;
    process.env.API_BASE_URL = prevApi;
    process.env.NEXT_PUBLIC_API_BASE_URL = prevPublic;
  });

  it('does not require NEXT_PUBLIC for server-side BFF upstream', () => {
    const prevInternal = process.env.INTERNAL_API_BASE_URL;
    const prevApi = process.env.API_BASE_URL;
    const prevPublic = process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
    expect(internalApiBaseUrl()).toMatch(/\/api\/v1$/);
    expect(internalApiBaseUrl()).not.toContain('localhost:3001/profile');
    // NEXT_PUBLIC must not drive server upstream
    expect(internalApiBaseUrl()).toBe('http://127.0.0.1:3001/api/v1');
    process.env.INTERNAL_API_BASE_URL = prevInternal;
    process.env.API_BASE_URL = prevApi;
    process.env.NEXT_PUBLIC_API_BASE_URL = prevPublic;
  });

  it('appends /api/v1 when INTERNAL host has no prefix', () => {
    const prevInternal = process.env.INTERNAL_API_BASE_URL;
    const prevApi = process.env.API_BASE_URL;
    process.env.INTERNAL_API_BASE_URL = 'http://api:3001';
    delete process.env.API_BASE_URL;
    expect(internalApiBaseUrl()).toBe('http://api:3001/api/v1');
    process.env.INTERNAL_API_BASE_URL = prevInternal;
    process.env.API_BASE_URL = prevApi;
  });
});
