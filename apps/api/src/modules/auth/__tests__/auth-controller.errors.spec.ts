import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../controllers/auth.controller';
import { AuthAbuseBlockedError } from '../domain/auth-abuse.policy';

function responseStub() {
  const headers = new Map<string, string>();
  return {
    setHeader: (name: string, value: string | string[]) => headers.set(name, Array.isArray(value) ? value.join(';') : value),
    headers,
  };
}

describe('auth controller public errors', () => {
  it('returns equivalent invalid-credential envelopes for existing and nonexistent accounts', async () => {
    const controller = new AuthController({
      login: async (identifier: string) => {
        throw new Error(identifier === 'known@example.test' ? 'INVALID_CREDENTIALS' : 'INVALID_CREDENTIALS');
      },
    } as never);

    const known = await controller
      .login({ identifier: 'known@example.test', password: 'bad' }, { headers: {}, ip: '127.0.0.1' } as never, responseStub() as never)
      .catch((error: HttpException) => error);
    const unknown = await controller
      .login({ identifier: 'missing@example.test', password: 'bad' }, { headers: {}, ip: '127.0.0.1' } as never, responseStub() as never)
      .catch((error: HttpException) => error);

    expect(known.getStatus()).toBe(401);
    expect(unknown.getStatus()).toBe(401);
    expect(known.getResponse()).toEqual(unknown.getResponse());
    expect(JSON.stringify(known.getResponse())).not.toMatch(/known|missing|sql|stack|credentialHash|password/i);
  });

  it('sets Retry-After on temporary auth blocks', async () => {
    const controller = new AuthController({
      login: async () => {
        throw new AuthAbuseBlockedError('account_lockout', 600);
      },
    } as never);
    const res = responseStub();

    const error = await controller
      .login({ identifier: 'user@example.test', password: 'bad' }, { headers: {}, ip: '127.0.0.1' } as never, res as never)
      .catch((caught: HttpException) => caught);

    expect(error.getStatus()).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(error.getResponse()).toEqual({
      error: {
        code: 'AUTH_TEMPORARILY_BLOCKED',
        message: 'Authentication is temporarily unavailable.',
        retryAfterSeconds: 600,
      },
    });
  });
});
