import { describe, expect, it } from 'vitest';
import { AuthService } from '../application/auth.service';

describe('AuthService', () => {
  it('password hashing is salted and verifiable', () => {
    const service = new AuthService();
    const encoded = service.hashPassword('SafePassword123');
    expect(encoded).not.toBe(service.hashPassword('SafePassword123'));
    expect(service.verifyPassword('SafePassword123', encoded)).toBe(true);
    expect(service.verifyPassword('wrong', encoded)).toBe(false);
  });
});
