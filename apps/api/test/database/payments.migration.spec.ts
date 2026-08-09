import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('payments migration contract', () => {
  const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/130_payments/migration.sql'), 'utf8');
  it('creates payment aggregates with constraints and indexes', () => {
    expect(sql).toContain('CREATE TABLE "Payment"');
    expect(sql).toContain('CREATE TABLE "PaymentEvent"');
    expect(sql).toContain('CREATE TABLE "Refund"');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('CREATE INDEX "Payment_userId_createdAt_idx"');
  });
});
