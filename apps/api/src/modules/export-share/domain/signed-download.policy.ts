import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SignedDownload } from './export-document.types';

export function createSignedDownload(
  storageKey: string,
  ttlSeconds: number,
  secret: string,
  nowMs = Date.now(),
): SignedDownload {
  if (!storageKey || storageKey.includes('..') || storageKey.startsWith('/') || storageKey.includes('\\')) {
    throw new Error('EXPORT_STORAGE_KEY_INVALID');
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 86400) {
    throw new Error('EXPORT_SIGNED_TTL_INVALID');
  }
  if (!secret) throw new Error('EXPORT_SIGNING_SECRET_MISSING');
  const expiresAt = Math.floor(nowMs / 1000) + Math.floor(ttlSeconds);
  const signature = sign(storageKey, expiresAt, secret);
  const path = `/export-share/download?key=${encodeURIComponent(storageKey)}&expires=${expiresAt}&sig=${signature}`;
  return { storageKey, expiresAt, signature, path };
}

export function verifySignedDownload(
  storageKey: string,
  expiresAt: number,
  signature: string,
  secret: string,
  nowMs = Date.now(),
): void {
  if (!storageKey || !signature || !secret) throw new Error('EXPORT_DOWNLOAD_FORBIDDEN');
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < nowMs) throw new Error('EXPORT_DOWNLOAD_EXPIRED');
  const expected = sign(storageKey, expiresAt, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('EXPORT_DOWNLOAD_FORBIDDEN');
}

function sign(storageKey: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret).update(`${storageKey}:${expiresAt}`).digest('base64url');
}
