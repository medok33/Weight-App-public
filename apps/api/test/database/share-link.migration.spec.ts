import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('share-link migration', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/151_share-link/migration.sql'), 'utf8');
  it('creates ShareLink with token uniqueness and TTL columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ShareLink"');
    expect(sql).toContain('ShareLink_token_key');
    expect(sql).toContain('expiresAt');
    expect(sql).toContain('revokedAt');
  });
});
