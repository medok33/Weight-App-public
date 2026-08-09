import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSecurityHeaders } from './src/security/content-security-policy.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(appDir, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production Docker images use the standalone server output.
  output: 'standalone',
  // Keep tracing rooted at the monorepo (avoids nested local worktree lockfiles).
  outputFileTracingRoot: repoRoot,
  // Do not use build-time rewrites for /api/v1 — destination would bake 127.0.0.1
  // into GHCR images and break Docker Compose (`api` hostname). Runtime BFF:
  // apps/web/src/app/api/v1/[...path]/route.ts
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(process.env.NODE_ENV === 'development'),
      },
    ];
  },
};

export default nextConfig;
