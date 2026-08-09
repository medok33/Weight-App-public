import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { PlanKind, RevisionSnapshot } from './revision-engine.types';

export type ConfirmationTokenPayload = {
  userId: string;
  planId: string;
  planKind: PlanKind;
  sourceVersion: number;
  reason: string;
  snapshotHash: string;
  /** Structured STEP_093 substitution (or similar) — required to rebuild snapshot on confirm. */
  operationJson?: string;
  exp: number;
};

function secret(): string {
  const configured =
    process.env.PLAN_REVISION_CONFIRMATION_SECRET || process.env.REVISION_TOKEN_SECRET || '';
  if (configured) return configured;
  // Production runtime must configure an explicit secret. Vitest sets VITEST=true.
  if (process.env.NODE_ENV === 'production' && !process.env.VITEST) {
    throw new Error('PLAN_REVISION_CONFIRMATION_SECRET_REQUIRED');
  }
  // Local/test-only fallback. Never use DATABASE_URL or AUTH_SESSION_SECRET for signing.
  return 'local-revision-token-secret';
}

function encode(payload: ConfirmationTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function hashSnapshot(snapshot: RevisionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function hashConfirmRequest(input: {
  planId: string;
  planKind: PlanKind;
  confirmationToken: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ planId: input.planId, planKind: input.planKind, confirmationToken: input.confirmationToken }))
    .digest('hex');
}

export function issueConfirmationToken(payload: Omit<ConfirmationTokenPayload, 'exp'>, ttlSeconds = 900): string {
  const full: ConfirmationTokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = encode(full);
  return `${body}.${sign(body)}`;
}

export function verifyConfirmationToken(token: string, expected: {
  userId: string;
  planId: string;
  planKind: PlanKind;
}): ConfirmationTokenPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('REVISION_TOKEN_INVALID');
  const expectedSig = sign(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSig);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('REVISION_TOKEN_INVALID');
  let payload: ConfirmationTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConfirmationTokenPayload;
  } catch {
    throw new Error('REVISION_TOKEN_INVALID');
  }
  if (payload.userId !== expected.userId) throw new Error('REVISION_TOKEN_FORBIDDEN');
  if (payload.planId !== expected.planId || payload.planKind !== expected.planKind) throw new Error('REVISION_TOKEN_MISMATCH');
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('REVISION_TOKEN_EXPIRED');
  return payload;
}

export function validateIdempotencyKey(key: string): string {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new Error('REVISION_IDEMPOTENCY_KEY_INVALID');
  return key;
}
