import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const OWNER_MFA_POLICY = {
  totpPeriodSeconds: 30,
  totpDigits: 6,
  totpSkewSteps: 1,
  preAuthTtlSeconds: 5 * 60,
  enrollmentTtlSeconds: 10 * 60,
  recentReauthMaxAgeSeconds: 5 * 60,
  recoveryCodeCount: 10,
} as const;

export type EncryptedMfaPayload = {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string;
  tag: string;
  ciphertext: string;
};

export function loadMfaEncryptionKey(source: NodeJS.ProcessEnv = process.env): Buffer {
  const explicit = source.AUTH_MFA_ENCRYPTION_KEY?.trim();
  const env = String(source.APP_ENV ?? source.NODE_ENV ?? 'LOCAL').trim().toUpperCase();
  if (!explicit) {
    if (env === 'STAGING' || env === 'PRODUCTION') throw new Error('AUTH_MFA_ENCRYPTION_KEY_REQUIRED');
    return createHash('sha256').update('local-test-owner-mfa-encryption-key').digest();
  }
  const raw = explicit.startsWith('base64:') ? Buffer.from(explicit.slice(7), 'base64') : Buffer.from(explicit, 'hex');
  if (raw.length !== 32) throw new Error('AUTH_MFA_ENCRYPTION_KEY_INVALID');
  return raw;
}

export function encryptMfaSecret(secret: string, key = loadMfaEncryptionKey()): EncryptedMfaPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function decryptMfaSecret(payload: unknown, key = loadMfaEncryptionKey()): string {
  if (!isEncryptedMfaPayload(payload)) throw new Error('MFA_SECRET_ENVELOPE_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function provisioningUri(input: { issuer: string; accountName: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(OWNER_MFA_POLICY.totpDigits),
    period: String(OWNER_MFA_POLICY.totpPeriodSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now = Date.now(),
): { valid: true; timeStep: bigint } | { valid: false } {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false };
  const baseStep = Math.floor(now / 1000 / OWNER_MFA_POLICY.totpPeriodSeconds);
  for (let offset = -OWNER_MFA_POLICY.totpSkewSteps; offset <= OWNER_MFA_POLICY.totpSkewSteps; offset += 1) {
    const step = baseStep + offset;
    if (constantTimeEqual(totpAtStep(secret, step), normalized)) return { valid: true, timeStep: BigInt(step) };
  }
  return { valid: false };
}

export function recoveryCodeHash(userId: string, code: string): string {
  return createHash('sha256').update(`owner-recovery:${userId}:${normalizeRecoveryCode(code)}`).digest('hex');
}

export function generateRecoveryCodes(count = OWNER_MFA_POLICY.recoveryCodeCount): string[] {
  return Array.from({ length: count }, () => `${randomChunk()}-${randomChunk()}-${randomChunk()}`);
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function totpAtStep(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** OWNER_MFA_POLICY.totpDigits).padStart(OWNER_MFA_POLICY.totpDigits, '0');
}

function randomChunk(): string {
  return randomBytes(3).toString('base64url').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isEncryptedMfaPayload(value: unknown): value is EncryptedMfaPayload {
  const row = value as Partial<EncryptedMfaPayload> | null;
  return row?.v === 1 && row.alg === 'AES-256-GCM' && typeof row.iv === 'string' && typeof row.tag === 'string' && typeof row.ciphertext === 'string';
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/g, '').toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error('MFA_SECRET_INVALID');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
