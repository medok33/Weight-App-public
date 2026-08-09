import { describe, expect, it } from 'vitest';
import {
  browserApiBaseUrl,
  ensureApiV1Base,
  isDirectNestProfileUrl,
  joinApiPath,
  resolveInternalApiBaseUrl,
  SAME_ORIGIN_API_BASE,
} from '../api-base';
import { resolveBrowserApiUrl } from '../api-fetch';

describe('api-base browser/server separation (BUGFIX-PROFILE-SAVE-01)', () => {
  it('browser base is always same-origin /api/v1', () => {
    expect(browserApiBaseUrl({})).toBe(SAME_ORIGIN_API_BASE);
    expect(browserApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001' })).toBe(
      SAME_ORIGIN_API_BASE,
    );
    expect(browserApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001/api/v1' })).toBe(
      SAME_ORIGIN_API_BASE,
    );
    expect(browserApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: '/api/v1' })).toBe(SAME_ORIGIN_API_BASE);
    expect(browserApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: '/api/v1/' })).toBe(SAME_ORIGIN_API_BASE);
  });

  it('joinApiPath builds /api/v1/profile without doubling prefix', () => {
    expect(joinApiPath('/api/v1', '/profile')).toBe('/api/v1/profile');
    expect(joinApiPath('/api/v1/', 'profile')).toBe('/api/v1/profile');
    expect(joinApiPath('/api/v1', '/api/v1/profile')).toBe('/api/v1/profile');
    expect(joinApiPath('http://api:3001/api/v1', '/profile')).toBe('http://api:3001/api/v1/profile');
    expect(joinApiPath('http://api:3001/api/v1', '/api/v1/profile')).toBe(
      'http://api:3001/api/v1/profile',
    );
  });

  it('resolveBrowserApiUrl never targets bare Nest /profile', () => {
    expect(resolveBrowserApiUrl('/profile')).toBe('/api/v1/profile');
    expect(resolveBrowserApiUrl('profile')).toBe('/api/v1/profile');
    expect(resolveBrowserApiUrl('/goal')).toBe('/api/v1/goal');
    expect(isDirectNestProfileUrl(resolveBrowserApiUrl('/profile'))).toBe(false);
  });

  it('detects forbidden direct Nest profile URLs', () => {
    expect(isDirectNestProfileUrl('http://localhost:3001/profile')).toBe(true);
    expect(isDirectNestProfileUrl('http://127.0.0.1:3001/profile')).toBe(true);
    expect(isDirectNestProfileUrl('http://localhost:3001/api/v1/profile')).toBe(false);
    expect(isDirectNestProfileUrl('/api/v1/profile')).toBe(false);
  });

  it('ensureApiV1Base appends prefix once', () => {
    expect(ensureApiV1Base('http://api:3001')).toBe('http://api:3001/api/v1');
    expect(ensureApiV1Base('http://api:3001/api/v1')).toBe('http://api:3001/api/v1');
    expect(ensureApiV1Base('http://api:3001/api/v1/')).toBe('http://api:3001/api/v1');
  });

  it('resolveInternalApiBaseUrl prefers INTERNAL and ignores NEXT_PUBLIC', () => {
    expect(
      resolveInternalApiBaseUrl({
        INTERNAL_API_BASE_URL: 'http://api:3001/api/v1/',
        API_BASE_URL: 'http://ignored:9',
      }),
    ).toBe('http://api:3001/api/v1');
    expect(
      resolveInternalApiBaseUrl({
        API_BASE_URL: 'http://127.0.0.1:3001',
      }),
    ).toBe('http://127.0.0.1:3001/api/v1');
    expect(resolveInternalApiBaseUrl({})).toBe('http://127.0.0.1:3001/api/v1');
  });
});
