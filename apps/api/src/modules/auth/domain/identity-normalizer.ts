export function normalizeIdentityEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('EMAIL_REQUIRED');
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !normalized.includes('@')) throw new Error('EMAIL_INVALID');
  return normalized;
}
export const AUTH_REGISTRATION_MODE = (): 'OPEN' | 'INVITE_ONLY' =>
  String(process.env.AUTH_REGISTRATION_MODE ?? 'OPEN').trim().toUpperCase() === 'INVITE_ONLY' ? 'INVITE_ONLY' : 'OPEN';
