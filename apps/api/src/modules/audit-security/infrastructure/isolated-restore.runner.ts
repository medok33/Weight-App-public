import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  assertDisposableDatabaseName,
  databaseNameFromUrl,
  evaluateRestoreIntegrity,
} from '../domain/audit-security.policy';
import type { BackupSnapshot, RestoreIntegrityChecks } from '../domain/audit-security.types';

const { Client } = pg;

const MINIMAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS "User" (
  "id" UUID PRIMARY KEY,
  "email" TEXT
);
CREATE TABLE IF NOT EXISTS "Session" (
  "id" UUID PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "tokenHash" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id" UUID PRIMARY KEY,
  "action" TEXT NOT NULL,
  "actorUserId" UUID
);
`;

/**
 * Runs restore against a disposable Postgres database created on the same server.
 * Never connects write paths to the primary application database for restore.
 */
export class IsolatedRestoreRunner {
  constructor(private readonly primaryUrl: string) {}

  primaryDatabaseName(): string {
    return databaseNameFromUrl(this.primaryUrl);
  }

  async run(snapshot: BackupSnapshot): Promise<{
    targetDatabase: string;
    checks: RestoreIntegrityChecks;
  }> {
    const primary = this.primaryDatabaseName();
    const targetDatabase = `weight_app_restore_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    assertDisposableDatabaseName(targetDatabase, primary);

    const admin = new Client({ connectionString: this.adminUrl() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${targetDatabase}"`);
    } finally {
      await admin.end();
    }

    const target = new Client({ connectionString: this.urlForDatabase(targetDatabase) });
    try {
      await target.connect();
      await target.query(MINIMAL_SCHEMA);
      for (const user of snapshot.tables.User) {
        await target.query('INSERT INTO "User" (id, email) VALUES ($1,$2)', [user.id, user.email]);
      }
      for (const session of snapshot.tables.Session) {
        await target.query('INSERT INTO "Session" (id, "userId", "tokenHash") VALUES ($1,$2,$3)', [
          session.id,
          session.userId,
          session.tokenHash,
        ]);
      }
      for (const event of snapshot.tables.AuditEvent) {
        await target.query('INSERT INTO "AuditEvent" (id, action, "actorUserId") VALUES ($1,$2,$3)', [
          event.id,
          event.action,
          event.actorUserId,
        ]);
      }

      const counts = await target.query<{
        users: string;
        sessions: string;
        audits: string;
        orphans: string;
      }>(`
        SELECT
          (SELECT COUNT(*)::text FROM "User") AS users,
          (SELECT COUNT(*)::text FROM "Session") AS sessions,
          (SELECT COUNT(*)::text FROM "AuditEvent") AS audits,
          (SELECT COUNT(*)::text FROM "Session" s LEFT JOIN "User" u ON u.id = s."userId" WHERE u.id IS NULL) AS orphans
      `);
      const row = counts.rows[0];
      const checks = evaluateRestoreIntegrity(snapshot, {
        userCount: Number(row.users),
        sessionCount: Number(row.sessions),
        auditEventCount: Number(row.audits),
        orphanSessions: Number(row.orphans),
      });
      return { targetDatabase, checks };
    } finally {
      await target.end().catch(() => undefined);
      const dropper = new Client({ connectionString: this.adminUrl() });
      await dropper.connect();
      try {
        await dropper.query(
          `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()
        `,
          [targetDatabase],
        );
        await dropper.query(`DROP DATABASE IF EXISTS "${targetDatabase}"`);
      } finally {
        await dropper.end();
      }
    }
  }

  private adminUrl(): string {
    return this.urlForDatabase('postgres');
  }

  private urlForDatabase(database: string): string {
    const u = new URL(this.primaryUrl);
    u.pathname = `/${database}`;
    return u.toString();
  }
}
