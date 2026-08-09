import type { AuthProvider, SessionPolicy } from './auth.types';

export const AUTH_PROVIDERS: readonly AuthProvider[] = ['email', 'vk', 'telegram'];
export const SESSION_POLICY: SessionPolicy = { ttlSeconds: 60 * 60 * 24 * 30, rotateOnUse: true };
export const PASSWORD_POLICY = { minLength: 12, requireUppercase: true, requireNumber: true } as const;
export const MFA_POLICY = { ownerRequired: true, issuer: 'Weight App' } as const;
export function isSupportedProvider(provider: string): provider is AuthProvider { return AUTH_PROVIDERS.includes(provider as AuthProvider); }
export function isPasswordAcceptable(password: string): boolean { return password.length >= PASSWORD_POLICY.minLength && /[A-Z]/.test(password) && /\d/.test(password); }
