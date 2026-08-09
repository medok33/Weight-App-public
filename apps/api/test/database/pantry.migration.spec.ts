import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('pantry migration STEP_175', () => {
  it('creates Pantry and PantryItem with ownership indexes', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/159_pantry/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "Pantry"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "PantryItem"');
    expect(sql).toContain('Pantry_userId_key');
    expect(sql).toContain('PantryItem_pantryId_name_unit_key');
    expect(sql).toContain('PantryItem_expiresOn_idx');
  });
});
