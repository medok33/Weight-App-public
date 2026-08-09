import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-fetch';
import { mapUnknownToUiError } from '@/lib/map-api-error';

describe('dashboard / profile error mapping contracts', () => {
  it('401 maps to unauthenticated (login redirect path)', () => {
    expect(mapUnknownToUiError(new ApiError(401)).kind).toBe('unauthenticated');
  });

  it('403 maps to forbidden (no login redirect)', () => {
    expect(mapUnknownToUiError(new ApiError(403)).kind).toBe('forbidden');
  });

  it('service errors are retryable', () => {
    expect(mapUnknownToUiError(new ApiError(500)).retryable).toBe(true);
  });
});
