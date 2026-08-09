/**
 * Single source of Content-Security-Policy for the Next.js web app.
 * Development may include 'unsafe-eval' for React/Next debugging; production must not.
 */
function apiConnectSource(value) {
  if (!value) return 'http://localhost:3001';
  try {
    const url = new globalThis.URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return 'http://localhost:3001';
    }
    return url.origin;
  } catch {
    return 'http://localhost:3001';
  }
}

export function buildContentSecurityPolicy(
  isDev = process.env.NODE_ENV === 'development',
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL,
) {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])].join(' ');
  const connectSource = apiConnectSource(apiBaseUrl);
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    `connect-src 'self' ${connectSource}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; ');
}

export function buildSecurityHeaders(
  isDev = process.env.NODE_ENV === 'development',
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL,
) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(isDev, apiBaseUrl) },
  ];
}
