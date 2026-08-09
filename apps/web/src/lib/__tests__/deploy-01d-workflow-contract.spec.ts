import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('DEPLOY-01D workflow contracts', () => {
  const root = resolve(__dirname, '../../../../..');
  const workflowsDir = resolve(root, '.github/workflows');

  it('pins third-party actions to full commit SHAs', () => {
    for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'))) {
      const text = readFileSync(resolve(workflowsDir, file), 'utf8');
      for (const line of text.split('\n')) {
        if (!/^\s*-?\s*uses:\s*/.test(line) || line.trim().startsWith('#')) continue;
        if (/uses:\s*\./.test(line)) continue;
        expect(line, file).toMatch(/@[0-9a-f]{40}\b/);
        expect(line, file).not.toMatch(/@(v?\d+(\.\d+)*)\s*$/);
      }
    }
  });

  it('keeps CI least-privilege and non-publishing', () => {
    const ci = readFileSync(resolve(workflowsDir, 'ci.yml'), 'utf8');
    expect(ci).toContain('contents: read');
    expect(ci).not.toMatch(/packages:\s*write/);
    expect(ci).not.toContain('pull_request_target');
    expect(ci).toContain('pnpm install --frozen-lockfile');
    expect(ci).toContain('pnpm verify');
    expect(ci).toContain('pnpm docker:validate:compose');
  });

  it.skip('PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE: publishes only from release workflow with lowercase GHCR names', () => {
    const release = readFileSync(resolve(workflowsDir, 'release-images.yml'), 'utf8');
    expect(release).toContain('packages: write');
    expect(release).toContain('ghcr.io/medok33/weight-app-web');
    expect(release).toContain('ghcr.io/medok33/weight-app-api');
    expect(release).toContain('ghcr.io/medok33/weight-app-worker');
    expect(release).toContain('ghcr.io/medok33/weight-app-migrate');
    expect(release).not.toMatch(/^\s*pull_request:/m);
    expect(release).not.toMatch(/type=raw,value=latest/);
  });
});
