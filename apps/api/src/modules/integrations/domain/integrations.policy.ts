import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export function validatePartnerFeed(feed: { partnerId?: string; fetchPrices?: unknown }) { if (!feed.partnerId || typeof feed.fetchPrices !== 'function') throw new Error('PARTNER_FEED_INVALID'); return feed; }
export function validateOAuthState(state: string, nonce: string) {
  if (!state || !nonce) throw new Error('INTEGRATION_OAUTH_STATE_INVALID');
  const left = Buffer.from(state);
  const right = Buffer.from(nonce);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('INTEGRATION_OAUTH_STATE_INVALID');
  }
  return true;
}
export function verifyWebhookSignature(raw: string, secret: string, signature: string) { const expected = createHash('sha256').update(`${secret}:${raw}`).digest('hex'); return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
export function assertOutboundAllowlisted(url: string, allowlist: string[]) { const host = new URL(url).hostname; if (!allowlist.includes(host)) throw new Error('INTEGRATION_OUTBOUND_BLOCKED'); return url; }
export function classifyIntegrationError(error: unknown) { return /timeout|5\d\d/i.test(error instanceof Error ? error.message : '') ? 'RETRYABLE' : 'FAILED'; }
function key() { const secret = process.env.INTEGRATION_TOKEN_KEY ?? 'test-integration-token-key-only'; return createHash('sha256').update(secret).digest(); }
export function encryptToken(token: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv); const encrypted = Buffer.concat([cipher.update(token, 'utf8'),cipher.final()]); return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`; }
export function decryptToken(value: string) { const [iv,tag,ciphertext] = value.split('.'); const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv,'base64')); decipher.setAuthTag(Buffer.from(tag,'base64')); return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64')),decipher.final()]).toString('utf8'); }
export const HEALTH_DATA_CATEGORIES = ['weight','body_measurements','activity','workouts','calories','nutrition','sleep','heart'] as const;
export type HealthDataCategory = typeof HEALTH_DATA_CATEGORIES[number];
export type HealthConsent = { userId: string; providerId: string; dataCategory: HealthDataCategory; direction: 'READ' | 'WRITE'; purpose: string; consentVersion: string; status: 'GRANTED' | 'REVOKED' | 'EXPIRED'; source?: string };
export function validateConsentGrant(input: Partial<HealthConsent> & { source?: string }): asserts input is Omit<HealthConsent, 'status'> & { source?: string } {
  if (!input.userId || !input.providerId || !input.purpose || !input.consentVersion || !HEALTH_DATA_CATEGORIES.includes(input.dataCategory as HealthDataCategory) || !['READ','WRITE'].includes(input.direction ?? '')) throw new Error('HEALTH_CONSENT_INVALID');
}
export function assertConsent(consents: HealthConsent[], userId: string, providerId: string, category: HealthDataCategory, direction: 'READ' | 'WRITE') {
  if (!consents.some((c) => c.userId === userId && c.providerId === providerId && c.dataCategory === category && c.direction === direction && c.status === 'GRANTED')) throw new Error('HEALTH_CONSENT_REQUIRED');
  return true;
}
export function filterHealthDataForAi(consents: HealthConsent[], payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([category]) => consents.some((c) => c.dataCategory === category && c.direction === 'READ' && c.status === 'GRANTED')));
}
export function resolveMeasurementConflict<T extends { updatedAt: string; source: string }>(existing: T, incoming: T): { action: 'MERGE' | 'CONFLICT'; value?: T } {
  if (existing.source === incoming.source || Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)) return { action: 'MERGE', value: incoming };
  return { action: 'CONFLICT' };
}
