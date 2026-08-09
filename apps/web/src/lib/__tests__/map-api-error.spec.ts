import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-fetch';
import { classifyApiErrorKind, mapUnknownToUiError } from '../map-api-error';
import { loginUrlWithReturnTo, safeReturnTo } from '../session-redirect';

describe('mapUnknownToUiError', () => {
  it('classifies network / offline', () => {
    const mapped = mapUnknownToUiError(new ApiError(0, 'NETWORK'));
    expect(mapped.kind).toBe('network');
    expect(mapped.retryable).toBe(true);
    expect(mapped.explanation).not.toMatch(/stack|SELECT |http:\/\//i);
  });

  it('classifies 401 as unauthenticated', () => {
    const mapped = mapUnknownToUiError(new ApiError(401));
    expect(mapped.kind).toBe('unauthenticated');
    expect(mapped.code).toBe('UNAUTHORIZED');
  });

  it('classifies 403 as forbidden', () => {
    const mapped = mapUnknownToUiError(new ApiError(403));
    expect(mapped.kind).toBe('forbidden');
  });

  it('classifies validation / not found / conflict / rate limit / 5xx / degraded', () => {
    expect(classifyApiErrorKind({ status: 400 })).toBe('validation');
    expect(classifyApiErrorKind({ status: 404 })).toBe('not_found');
    expect(classifyApiErrorKind({ status: 409 })).toBe('conflict');
    expect(classifyApiErrorKind({ status: 429 })).toBe('rate_limit');
    expect(classifyApiErrorKind({ status: 500 })).toBe('service');
    expect(classifyApiErrorKind({ status: 502 })).toBe('degraded');
    expect(classifyApiErrorKind({ code: 'DEGRADED_DEPENDENCY' })).toBe('degraded');
  });

  it('maps ApiError SERVER (5xx) to SERVICE_UNAVAILABLE copy, not UNKNOWN', () => {
    const mapped = mapUnknownToUiError(new ApiError(500));
    expect(mapped.kind).toBe('service');
    expect(mapped.code).toBe('SERVICE_UNAVAILABLE');
    expect(mapped.title).toBe('Сервис временно недоступен');
    expect(mapped.explanation).toBe('Повторите попытку позже.');
  });

  it('uses the English error catalog when requested', () => {
    const mapped = mapUnknownToUiError(new ApiError(500), { locale: 'en' });
    expect(mapped.title).toBe('Service temporarily unavailable');
    expect(mapped.explanation).toBe('Try again later.');
  });

  it('never echoes technical payload text from Error.message', () => {
    const mapped = mapUnknownToUiError(
      Object.assign(new Error('SELECT * FROM users at http://127.0.0.1:3001'), { status: 500 }),
    );
    expect(mapped.explanation).not.toMatch(/SELECT|127\.0\.0\.1/i);
  });
});

describe('safeReturnTo / loginUrlWithReturnTo', () => {
  it('rejects open redirects and auth loops', () => {
    expect(safeReturnTo('https://evil.example')).toBe('/dashboard-today');
    expect(safeReturnTo('//evil.example')).toBe('/dashboard-today');
    expect(safeReturnTo('/login')).toBe('/dashboard-today');
    expect(safeReturnTo('/register')).toBe('/dashboard-today');
    expect(safeReturnTo('/settings')).toBe('/settings');
  });

  it('rejects encoded, backslash, and javascript variants', () => {
    expect(safeReturnTo('%2F%2Fexample.com')).toBe('/dashboard-today');
    expect(safeReturnTo('/\\example.com')).toBe('/dashboard-today');
    expect(safeReturnTo('/\\\\example.com')).toBe('/dashboard-today');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/dashboard-today');
    expect(safeReturnTo('/dashboard?x=javascript:alert(1)')).toBe('/dashboard-today');
  });

  it('builds login URL with next param', () => {
    expect(loginUrlWithReturnTo('/settings')).toBe('/login?next=%2Fsettings');
  });
});
