import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { isPasswordAcceptable } from '../domain/auth.policy';

export class AuthService {
  hashPassword(password: string): string { if (!isPasswordAcceptable(password)) throw new Error('PASSWORD_POLICY_VIOLATION'); const salt = randomBytes(16); return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`; }
  verifyPassword(password: string, encoded: string): boolean { const [saltHex, hashHex] = encoded.split(':'); if (!saltHex || !hashHex) return false; const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 32); return timingSafeEqual(actual, Buffer.from(hashHex, 'hex')); }
}
