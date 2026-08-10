import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

describe('DEPLOY-01B docker packaging contracts', () => {
  const root = resolve(__dirname, '../../../../..');

  it('defines immutable tag pattern in build script', () => {
    const src = readFileSync(resolve(root, 'scripts/deploy/build-images.mjs'), 'utf8');
    expect(src).toContain('weight-app-web:${release}-${shortSha}');
    expect(src).toContain('weight-app-api:${release}-${shortSha}');
    expect(src).toContain('weight-app-worker:${release}-${shortSha}');
    expect(src).toContain("'0.0.0-local'");
    const webDocker = readFileSync(resolve(root, 'docker/Dockerfile.web'), 'utf8');
    expect(webDocker).toContain('pnpm install --frozen-lockfile');
  });

  it('keeps migration job separate from API CMD', () => {
    const dockerfile = readFileSync(resolve(root, 'docker/Dockerfile.api'), 'utf8');
    expect(dockerfile).toContain('FROM runtime-base AS api');
    expect(dockerfile).toContain('FROM runtime-base AS migrate');
    expect(dockerfile).toMatch(/AS api[\s\S]*CMD \["node", "dist\/main\.js"\]/);
    expect(dockerfile).toMatch(/AS migrate[\s\S]*CMD \["node", "scripts\/migrate\.mjs"\]/);
    expect(dockerfile).not.toContain('prisma migrate');
    expect(dockerfile).not.toContain('_prisma_migrations');
  });

  it('places disposable-runtime guard at migrate.mjs resolved import path', () => {
    const dockerfile = readFileSync(resolve(root, 'docker/Dockerfile.api'), 'utf8');
    const migrate = readFileSync(resolve(root, 'apps/api/scripts/migrate.mjs'), 'utf8');
    expect(migrate).toContain("from '../../../scripts/verify/disposable-runtime.mjs'");
    // Image layout: /app/scripts/migrate.mjs + ../../../scripts/verify => /scripts/verify
    expect(dockerfile).toContain(
      'COPY --from=build --chown=weightapp:weightapp /app/scripts/verify/disposable-runtime.mjs /scripts/verify/disposable-runtime.mjs',
    );
    expect(dockerfile).toContain(
      'COPY --from=build --chown=weightapp:weightapp /app/scripts/verify/orchestration.mjs /scripts/verify/orchestration.mjs',
    );
    expect(dockerfile).not.toMatch(
      /COPY --from=build[^\n]*\.\/scripts\/verify\/disposable-runtime\.mjs/,
    );
    expect(posix.resolve('/app/scripts', '../../../scripts/verify/disposable-runtime.mjs')).toBe(
      '/scripts/verify/disposable-runtime.mjs',
    );
  });

  it.skip('PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE: prod-like compose has no app source mounts and orders migrate before api', () => {
    const compose = readFileSync(resolve(root, 'docker/compose.prod-like.yaml'), 'utf8');
    expect(compose).not.toMatch(/\.\/apps\//);
    expect(compose).toContain('condition: service_completed_successfully');
    expect(compose).toContain('weight-app-migrate');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('cap_drop:');
    expect(compose).not.toContain('compose.staging');
  });

  it.skip('PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE: staging and production require immutable images in compose files', () => {
    const staging = readFileSync(resolve(root, 'docker/compose.staging.yaml'), 'utf8');
    const production = readFileSync(resolve(root, 'docker/compose.production.yaml'), 'utf8');
    expect(staging).toContain('API_IMAGE:?');
    expect(production).toContain('WEB_IMAGE:?');
    expect(staging).not.toContain('postgres-prodlike');
    expect(production).not.toContain('postgres-prodlike');
  });
});
