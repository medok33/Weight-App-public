import { SetMetadata } from '@nestjs/common';
import { OWNER_MFA_POLICY } from '../domain/owner-mfa.crypto';

export const REQUIRE_RECENT_OWNER_REAUTH_KEY = 'require_recent_owner_reauth';

export type RequireRecentOwnerReauthOptions = {
  maxAgeSeconds?: number;
};

export const RequireRecentOwnerReauth = (options: RequireRecentOwnerReauthOptions = {}) =>
  SetMetadata(REQUIRE_RECENT_OWNER_REAUTH_KEY, {
    maxAgeSeconds: options.maxAgeSeconds ?? OWNER_MFA_POLICY.recentReauthMaxAgeSeconds,
  });
