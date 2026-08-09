import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('owner MFA migrations', () => {
  it('owner MFA gate migration created placeholder challenge table historically', () => {
    const sql = readFileSync('prisma/migrations/117_owner-mfa-gate/migration.sql', 'utf8');
    expect(sql).toMatch(/CREATE TABLE "OwnerMfaChallenge"/);
    expect(sql).toMatch(/CREATE TABLE "OwnerAuditEvent"/);
    expect(sql).toMatch(/OwnerMfaChallenge_userId_fkey/);
  });

  it('owner real MFA migration creates authoritative credential tables', () => {
    const sql = readFileSync('prisma/migrations/204_owner-real-mfa/migration.sql', 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "OwnerMfaCredential"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "MfaPreAuthChallenge"/);
    expect(sql).toMatch(/OwnerMfaCredential_one_active_user/);
  });

  it('owner MFA challenge retirement migration drops legacy table', () => {
    const sql = readFileSync('prisma/migrations/205_retire-owner-mfa-challenge/migration.sql', 'utf8');
    expect(sql).toMatch(/DROP TABLE IF EXISTS "OwnerMfaChallenge"/);
  });

  it('auth throttle MFA subjects migration widens action/subject checks', () => {
    const sql = readFileSync('prisma/migrations/206_auth-throttle-mfa-subjects/migration.sql', 'utf8');
    expect(sql).toMatch(/mfa_challenge/);
    expect(sql).toMatch(/challenge/);
  });
});
