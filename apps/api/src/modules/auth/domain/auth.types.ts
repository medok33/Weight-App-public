export type AuthProvider = 'email' | 'vk' | 'telegram';
export interface AuthIdentity { provider: AuthProvider; providerSubject: string; }
export interface SessionPolicy { ttlSeconds: number; rotateOnUse: boolean; }
export interface PasswordPolicy { minLength: number; requireUppercase: boolean; requireNumber: boolean; }
export interface AuthSession { id: string; userId: string; expiresAt: Date; revokedAt?: Date; deviceLabel?: string; }
export interface MfaPolicy { ownerRequired: boolean; issuer: string; }
