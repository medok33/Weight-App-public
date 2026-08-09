import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './content-security-policy.mjs';

describe('Content-Security-Policy', () => {
  it('development CSP includes unsafe-eval and required directives', () => {
    const csp = buildContentSecurityPolicy(true, '');
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' http://localhost:3001");
    expect(csp).toContain("base-uri 'self'");
  });

  it('production CSP omits unsafe-eval and keeps required directives', () => {
    const csp = buildContentSecurityPolicy(false, '');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' http://localhost:3001");
    expect(csp).toContain("base-uri 'self'");
  });

  it('restricts disposable browser connections to the configured API origin', () => {
    const csp = buildContentSecurityPolicy(false, 'http://localhost:33001/api/v1');
    expect(csp).toContain("connect-src 'self' http://localhost:33001");
    expect(csp).not.toContain('/api/v1');
  });

  it('does not inject credentials or unsupported schemes into connect-src', () => {
    expect(buildContentSecurityPolicy(false, 'http://user:secret@localhost:33001/api/v1')).toContain(
      "connect-src 'self' http://localhost:3001",
    );
    expect(buildContentSecurityPolicy(false, 'javascript:alert(1)')).toContain(
      "connect-src 'self' http://localhost:3001",
    );
  });
});
