import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Baseline security headers for API responses (STEP_149). */
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // API is JSON-first; CSP is restrictive for any accidental HTML error pages.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  }
}

export function csrfOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  // ARCH-SEC-02A: missing Origin is not implicitly allowed for cookie mutations.
  // Guard uses browserMutationOriginAllowed; this helper remains for allowlist equality checks.
  if (!origin) return false;
  try {
    const normalized = origin.trim().replace(/\/+$/, '');
    return allowed.some((item) => item === normalized || item === origin);
  } catch {
    return false;
  }
}
