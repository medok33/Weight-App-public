import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('family mode migration STEP_180', () => {
  it('maps STEP_180 to sequential migration 160 and protects invitation tokens', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/160_family-mode/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "Family"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "FamilyMember"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "FamilyInvitation"');
    expect(sql).toContain('"tokenHash"');
    expect(sql).toContain('FamilyInvitation_tokenHash_key');
    expect(sql).toContain('"healthShareConsent" boolean NOT NULL DEFAULT false');
  });
});
