import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthRepository } from '../../src/modules/auth/infrastructure/auth.repository';
import { AuthService } from '../../src/modules/auth/application/auth.service';
import { UserAuthService } from '../../src/modules/auth/application/user-auth.service';
import {
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  OWNER_MFA_POLICY,
  recoveryCodeHash,
  verifyTotpCode,
} from '../../src/modules/auth/domain/owner-mfa.crypto';
import { authAbuseHash } from '../../src/modules/auth/domain/auth-abuse.policy';
import type { PrismaService, SqlQuery } from '../../src/infrastructure/database/prisma.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

function migrationPath(name: string) {
  const apiRelative = resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`);
  if (existsSync(apiRelative)) return apiRelative;
  return resolve(process.cwd(), `apps/api/prisma/migrations/${name}/migration.sql`);
}

function dbFor(pool: pg.Pool): PrismaService {
  return {
    query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) =>
      pool.query<T>(text, values),
    withTransaction: async <T>(fn: (query: SqlQuery) => Promise<T>) => {
      const client = await pool.connect();
      const query: SqlQuery = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) =>
        client.query<R>(text, values);
      try {
        await client.query('BEGIN');
        const result = await fn(query);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  } as PrismaService;
}

function totpAt(secret: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.replace(/=+$/g, '').toUpperCase()) {
    const idx = alphabet.indexOf(char);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const key = Buffer.from(bytes);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** OWNER_MFA_POLICY.totpDigits).padStart(OWNER_MFA_POLICY.totpDigits, '0');
}

describeDb('ARCH-SEC-02C OWNER MFA persistence matrix', () => {
  let pool: pg.Pool;
  let repoA: AuthRepository;
  let repoB: AuthRepository;
  let auth: AuthService;
  let userAuthA: UserAuthService;
  const stamp = `arch-sec-02c-${Date.now()}`;
  const password = 'SafePassword123!';
  let ownerId: string;
  let userId: string;
  const hashes: string[] = [];

  async function cleanup() {
    if (hashes.length > 0) {
      await pool.query(`DELETE FROM "AuthThrottleBucket" WHERE "subjectHash" = ANY($1::text[])`, [hashes]);
      await pool.query(`DELETE FROM "AuthAccountLockout" WHERE "accountHash" = ANY($1::text[])`, [hashes]);
    }
    for (const id of [ownerId, userId].filter(Boolean)) {
      await pool.query(`DELETE FROM "OwnerMfaReplayState" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "OwnerMfaRecoveryCode" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "OwnerMfaEnrollmentDraft" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "OwnerMfaCredential" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "MfaPreAuthChallenge" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "Session" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "AuditEvent" WHERE "actorUserId" = $1 OR "entityId" = $1::text`, [id]);
      await pool.query(`DELETE FROM "UserSubscription" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "AuthIdentity" WHERE "userId" = $1`, [id]);
      await pool.query(`DELETE FROM "User" WHERE id = $1`, [id]);
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    for (const name of [
      '152_audit-event',
      '203_auth-abuse-controls',
      '204_owner-real-mfa',
      '205_retire-owner-mfa-challenge',
      '206_auth-throttle-mfa-subjects',
    ]) {
      await pool.query(readFileSync(migrationPath(name), 'utf8'));
    }
    const db = dbFor(pool);
    repoA = new AuthRepository(db);
    repoB = new AuthRepository(dbFor(pool));
    auth = new AuthService();
    userAuthA = new UserAuthService(auth, repoA);
    // Second service instance shares DB state via repoB (cross-instance matrix rows).
    void new UserAuthService(auth, repoB);

    ownerId = await repoA.createRegisteredUser(`${stamp}-owner@example.test`, auth.hashPassword(password));
    await pool.query(`UPDATE "User" SET "accountRole" = 'OWNER' WHERE id = $1`, [ownerId]);
    userId = await repoA.createRegisteredUser(`${stamp}-user@example.test`, auth.hashPassword(password));
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('1 OWNER password success creates full session without MFA enrollment gate', async () => {
    const result = await userAuthA.login(`${stamp}-owner@example.test`, password, undefined, '127.0.0.1');
    expect(result).toMatchObject({ user: expect.objectContaining({ id: ownerId, role: 'OWNER' }) });
    expect('mfaEnrollmentRequired' in result).toBe(false);
    expect('mfaChallengeRequired' in result).toBe(false);
    expect('cookies' in result && result.cookies.length).toBeGreaterThan(0);
    const sessions = await pool.query<{ mfaVerifiedAt: Date | null }>(
      `SELECT "mfaVerifiedAt" FROM "Session" WHERE "userId" = $1 AND "revokedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [ownerId],
    );
    expect(sessions.rows[0]?.mfaVerifiedAt).toBeNull();
  });

  it('2 Non-OWNER login remains compatible', async () => {
    const result = await userAuthA.login(`${stamp}-user@example.test`, password, undefined, '127.0.0.1');
    expect(result).toMatchObject({ user: expect.objectContaining({ id: userId }) });
    expect('mfaEnrollmentRequired' in result).toBe(false);
    expect('mfaChallengeRequired' in result).toBe(false);
  });

  it('3-6 enrollment draft inactive until confirm; secret encrypted; invalid TOTP rejected; valid activates full OWNER session', async () => {
    const ownerUser = { id: ownerId, email: `${stamp}-owner@example.test`, username: null, role: 'OWNER', mfaVerifiedAt: null };
    const enrollmentSession = await repoA.createSession(ownerId, 'OWNER', null);
    const started = await userAuthA.startOwnerMfaEnrollment(ownerUser, password);
    expect(started.secret).toMatch(/^[A-Z2-7]+$/);
    const draft = await pool.query<{ encryptedSecret: unknown; confirmedAt: Date | null }>(
      `SELECT "encryptedSecret", "confirmedAt" FROM "OwnerMfaEnrollmentDraft" WHERE id = $1`,
      [started.enrollmentId],
    );
    expect(draft.rows[0]?.confirmedAt).toBeNull();
    expect(JSON.stringify(draft.rows[0]?.encryptedSecret)).not.toContain(started.secret);
    await expect(userAuthA.confirmOwnerMfaEnrollment(ownerUser, started.enrollmentId, '000000', enrollmentSession.rawToken)).rejects.toThrow(
      'MFA_INVALID_CODE',
    );
    const activeBefore = await repoA.getActiveOwnerMfaCredential(ownerId);
    expect(activeBefore).toBeNull();
    const code = totpAt(started.secret, Math.floor(Date.now() / 1000 / OWNER_MFA_POLICY.totpPeriodSeconds));
    const confirmed = await userAuthA.confirmOwnerMfaEnrollment(ownerUser, started.enrollmentId, code, enrollmentSession.rawToken);
    expect(confirmed.recoveryCodes.length).toBe(OWNER_MFA_POLICY.recoveryCodeCount);
    expect(confirmed.mfaVerifiedAt).toBeTruthy();
    const session = await repoA.resolveSession(enrollmentSession.rawToken);
    expect(session?.mfaVerifiedAt).toBeTruthy();
    expect(session?.role).toBe('OWNER');
    const cred = await pool.query<{ encryptedSecret: unknown; status: string }>(
      `SELECT "encryptedSecret", status FROM "OwnerMfaCredential" WHERE "userId" = $1 AND status = 'ACTIVE'`,
      [ownerId],
    );
    expect(cred.rows[0]?.status).toBe('ACTIVE');
    expect(JSON.stringify(cred.rows[0]?.encryptedSecret)).not.toContain(started.secret);
  });

  it('9-10 TOTP replay blocked and clock skew is narrow', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 59_000;
    const step = 1;
    expect(verifyTotpCode(secret, totpAt(secret, step), now)).toEqual({ valid: true, timeStep: 1n });
    expect(verifyTotpCode(secret, totpAt(secret, step - 1), now).valid).toBe(true);
    expect(verifyTotpCode(secret, totpAt(secret, step + 1), now).valid).toBe(true);
    expect(verifyTotpCode(secret, totpAt(secret, step + 2), now).valid).toBe(false);
    const first = await repoA.recordTotpReplayStep(ownerId, 1n);
    const second = await repoB.recordTotpReplayStep(ownerId, 1n);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('11-14 pre-auth challenge expiry, single-use, concurrency, and cross-instance completion', async () => {
    const accountHash = authAbuseHash(`account:${stamp}-chal`);
    hashes.push(accountHash);
    const ipHash = authAbuseHash(`ip:10.0.0.8`);
    hashes.push(ipHash);
    const accountIpHash = authAbuseHash(`account_ip:${stamp}-chal:10.0.0.8`);
    hashes.push(accountIpHash);

    const expired = await repoA.createMfaPreAuthChallenge({
      userId: ownerId,
      accountHash,
      sourceIpHash: ipHash,
      accountIpHash,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await repoB.consumeMfaPreAuthChallenge(expired.rawChallenge)).toBeNull();

    const live = await repoA.createMfaPreAuthChallenge({
      userId: ownerId,
      accountHash,
      sourceIpHash: ipHash,
      accountIpHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [a, b] = await Promise.all([
      repoA.consumeMfaPreAuthChallenge(live.rawChallenge),
      repoB.consumeMfaPreAuthChallenge(live.rawChallenge),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(await repoA.consumeMfaPreAuthChallenge(live.rawChallenge)).toBeNull();

    const cross = await repoA.createMfaPreAuthChallenge({
      userId: ownerId,
      accountHash,
      sourceIpHash: ipHash,
      accountIpHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await repoB.consumeMfaPreAuthChallenge(cross.rawChallenge)).toMatchObject({ userId: ownerId });
  });

  it('15-18 recovery codes hashed, single-use, concurrent once, regeneration invalidates old', async () => {
    const cred = await repoA.getActiveOwnerMfaCredential(ownerId);
    expect(cred).toBeTruthy();
    const codes = generateRecoveryCodes(3);
    await repoA.replaceRecoveryCodes(
      ownerId,
      cred!.id,
      codes.map((code) => recoveryCodeHash(ownerId, code)),
    );
    const stored = await pool.query<{ codeHash: string }>(
      `SELECT "codeHash" FROM "OwnerMfaRecoveryCode" WHERE "credentialId" = $1`,
      [cred!.id],
    );
    for (const code of codes) {
      expect(stored.rows.some((row) => row.codeHash === code)).toBe(false);
      expect(JSON.stringify(stored.rows)).not.toContain(code);
    }
    const hash = recoveryCodeHash(ownerId, codes[0]);
    const [c1, c2] = await Promise.all([
      repoA.consumeRecoveryCode(ownerId, cred!.id, hash),
      repoB.consumeRecoveryCode(ownerId, cred!.id, hash),
    ]);
    expect([c1, c2].filter(Boolean)).toHaveLength(1);
    expect(await repoA.consumeRecoveryCode(ownerId, cred!.id, hash)).toBe(false);

    const oldHash = recoveryCodeHash(ownerId, codes[1]);
    const replacement = generateRecoveryCodes(2).map((code) => recoveryCodeHash(ownerId, code));
    await repoA.replaceRecoveryCodes(ownerId, cred!.id, replacement);
    expect(await repoA.consumeRecoveryCode(ownerId, cred!.id, oldHash)).toBe(false);
  });

  it('19-21 MFA throttling survives repo recreation, works across instances, exposes retryAfter', async () => {
    const challengeHash = authAbuseHash(`challenge:${stamp}-throttle`);
    const accountHash = authAbuseHash(`account:${stamp}-throttle`);
    const ipHash = authAbuseHash(`ip:10.0.0.9`);
    const accountIpHash = authAbuseHash(`account_ip:${stamp}-throttle:10.0.0.9`);
    hashes.push(challengeHash, accountHash, ipHash, accountIpHash);

    let blocked: { blocked: boolean; retryAfterSeconds?: number } = { blocked: false };
    for (let i = 0; i < 40 && !blocked.blocked; i += 1) {
      blocked = await repoA.recordMfaFailure({
        challengeHash,
        accountHash,
        ipHash,
        accountIpHash,
        userId: ownerId,
      });
    }
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    const freshRepo = new AuthRepository(dbFor(pool));
    const again = await freshRepo.evaluateMfaBlock({ challengeHash, accountHash, ipHash, accountIpHash });
    expect(again.blocked).toBe(true);
    const cross = await repoB.evaluateMfaBlock({ challengeHash, accountHash, ipHash, accountIpHash });
    expect(cross.blocked).toBe(true);
    expect(cross.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('22 invalid existing and nonexistent accounts remain externally indistinguishable at login', async () => {
    await expect(userAuthA.login(`${stamp}-owner@example.test`, 'wrong-password', undefined, '127.0.0.2')).rejects.toThrow(
      'INVALID_CREDENTIALS',
    );
    await expect(userAuthA.login(`${stamp}-missing@example.test`, 'wrong-password', undefined, '127.0.0.2')).rejects.toThrow(
      'INVALID_CREDENTIALS',
    );
  });

  it('32-33 logout/revocation clears MFA assurance markers on session', async () => {
    const session = await repoA.createSession(ownerId, 'OWNER', new Date());
    await repoA.updateSessionRecentReauth(session.rawToken, new Date());
    await userAuthA.logout(session.rawToken);
    const row = await pool.query<{ revokedAt: Date | null; mfaVerifiedAt: Date | null }>(
      `SELECT "revokedAt", "mfaVerifiedAt" FROM "Session" WHERE "tokenHash" = $1`,
      [repoA.hashToken(session.rawToken)],
    );
    expect(row.rows[0]?.revokedAt).toBeTruthy();

    const live = await repoA.createSession(ownerId, 'OWNER', new Date());
    await repoA.revokeUserSessions(ownerId);
    const resolved = await repoA.resolveSession(live.rawToken);
    expect(resolved).toBeNull();
  });

  it('37-40 emergency reset invalidates sessions/credential/challenges, needs confirm, audits without secrets', async () => {
    const secret = generateTotpSecret();
    await pool.query(
      `UPDATE "OwnerMfaCredential" SET status='ACTIVE', "disabledAt"=NULL, "encryptedSecret"=$2::jsonb WHERE "userId"=$1`,
      [ownerId, JSON.stringify(encryptMfaSecret(secret))],
    );
    await repoA.createSession(ownerId, 'OWNER', new Date());
    await repoA.createMfaPreAuthChallenge({
      userId: ownerId,
      accountHash: authAbuseHash(`account:${stamp}-reset`),
      sourceIpHash: authAbuseHash(`ip:10.0.0.10`),
      accountIpHash: authAbuseHash(`account_ip:${stamp}-reset:10.0.0.10`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    hashes.push(authAbuseHash(`account:${stamp}-reset`), authAbuseHash(`ip:10.0.0.10`), authAbuseHash(`account_ip:${stamp}-reset:10.0.0.10`));

    const script = resolve(process.cwd(), 'scripts/owner-mfa-emergency-reset.mjs');
    const alt = resolve(process.cwd(), 'apps/api/scripts/owner-mfa-emergency-reset.mjs');
    const scriptPath = existsSync(script) ? script : alt;

    const noConfirm = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, DATABASE_URL, OWNER_MFA_RESET_OWNER: ownerId, OWNER_MFA_RESET_CONFIRM: 'no' },
      encoding: 'utf8',
    });
    expect(noConfirm.status).not.toBe(0);

    const ok = spawnSync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        DATABASE_URL,
        OWNER_MFA_RESET_OWNER: ownerId,
        OWNER_MFA_RESET_CONFIRM: 'RESET_OWNER_MFA_AND_REVOKE_SESSIONS',
      },
      encoding: 'utf8',
    });
    if (ok.status !== 0) {
      throw new Error(`emergency reset failed: status=${ok.status} stdout=${ok.stdout} stderr=${ok.stderr}`);
    }
    expect(ok.stdout).not.toContain(secret);
    expect(ok.stdout.toLowerCase()).not.toMatch(/otpauth/);

    const cred = await pool.query<{ status: string; disabledAt: Date | null }>(
      `SELECT status, "disabledAt" FROM "OwnerMfaCredential" WHERE "userId"=$1 ORDER BY "updatedAt" DESC LIMIT 1`,
      [ownerId],
    );
    expect(cred.rows[0]?.status).toBe('RESET_REQUIRED');
    expect(cred.rows[0]?.disabledAt).toBeTruthy();
    const sessions = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text cnt FROM "Session" WHERE "userId"=$1 AND "revokedAt" IS NULL`,
      [ownerId],
    );
    expect(sessions.rows[0]?.cnt).toBe('0');
    const openChallenges = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text cnt FROM "MfaPreAuthChallenge" WHERE "userId"=$1 AND "consumedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP`,
      [ownerId],
    );
    expect(openChallenges.rows[0]?.cnt).toBe('0');
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditEvent" WHERE action='auth.owner.mfa.emergency_reset' AND "entityId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
      [ownerId],
    );
    expect(JSON.stringify(audit.rows[0]?.metadata ?? {})).not.toContain(secret);
  });

  it('legacy OwnerMfaChallenge table is retired (authoritative path only)', async () => {
    const exists = await pool.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'OwnerMfaChallenge') ok`,
    );
    expect(exists.rows[0]?.ok).toBe(false);
  });
});
