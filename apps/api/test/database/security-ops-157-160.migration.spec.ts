import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

describe('STEP_157–160 security ops migrations', () => {
  it('ships restore test, deploy run, threat review SQL', () => {
    const restore = readFileSync(resolve(migrationsRoot, '155_restore-test-result/migration.sql'), 'utf8');
    const deploy = readFileSync(resolve(migrationsRoot, '156_observability-deploy-run/migration.sql'), 'utf8');
    const threat = readFileSync(resolve(migrationsRoot, '157_threat-review/migration.sql'), 'utf8');
    expect(restore).toContain('CREATE TABLE IF NOT EXISTS "RestoreTestResult"');
    expect(deploy).toContain('CREATE TABLE IF NOT EXISTS "DeployRun"');
    expect(threat).toContain('CREATE TABLE IF NOT EXISTS "ThreatReview"');
  });
});
