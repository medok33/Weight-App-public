import { SetMetadata } from '@nestjs/common';

export const CSRF_EXEMPT_KEY = 'csrfExempt';

export type CsrfExemptMeta = {
  reason: string;
  trustMechanism: string;
};

/**
 * Marks a route as exempt from browser Origin/Referer CSRF checks.
 * Only for documented server-to-server / signature-verified endpoints.
 */
export const CsrfExempt = (meta: CsrfExemptMeta) => SetMetadata(CSRF_EXEMPT_KEY, meta);
