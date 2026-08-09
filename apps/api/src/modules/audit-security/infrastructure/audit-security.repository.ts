import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { validateAuditEventDraft, type AuditEventDraft, type AuditEventRecord } from '../domain/audit-event.policy';
import type {
  BackupJobRecord,
  BackupJobStatus,
  RestoreTestResult,
  ThreatReviewDraft,
} from '../domain/audit-security.types';

@Injectable()
export class AuditSecurityRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async session(hash: string) {
    const r = await this.db.query<{ userId: string; role: string; mfaVerifiedAt: Date | null }>(
      'SELECT "userId",role,"mfaVerifiedAt" FROM "Session" WHERE "tokenHash"=$1 AND "revokedAt" IS NULL AND "expiresAt">now()',
      [hash],
    );
    return r.rows[0];
  }

  /** Authoritative MFA path: active OwnerMfaCredential (legacy OwnerMfaChallenge is not trusted). */
  async mfa(userId: string) {
    const r = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM "OwnerMfaCredential"
         WHERE "userId"=$1 AND status='ACTIVE' AND "disabledAt" IS NULL
       ) ok`,
      [userId],
    );
    return r.rows[0]?.ok === true;
  }

  async audit(userId: string, action: string, metadata: Record<string, unknown>) {
    await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)', [
      userId,
      action,
      JSON.stringify(metadata),
    ]);
  }

  /** Append-only write path for AuditEvent (no update/delete helpers). */
  async appendAuditEvent(input: AuditEventDraft): Promise<AuditEventRecord> {
    const data = validateAuditEventDraft(input);
    const r = await this.db.query<AuditEventRecord>(
      `INSERT INTO "AuditEvent" ("actorUserId",action,"entityType","entityId","requestId",metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING id,"actorUserId",action,"entityType","entityId","requestId",metadata,"createdAt"::text`,
      [
        data.actorUserId,
        data.action,
        data.entityType,
        data.entityId,
        data.requestId,
        JSON.stringify(data.metadata ?? {}),
      ],
    );
    return r.rows[0];
  }

  async findBackupByIdempotency(idempotencyKey: string): Promise<BackupJobRecord | undefined> {
    const r = await this.db.query<BackupJobRecord>(
      `SELECT id, "idempotencyKey", status, "storageKey", "byteLength", "errorCode",
              "createdAt"::text, "updatedAt"::text
       FROM "BackupJob" WHERE "idempotencyKey"=$1`,
      [idempotencyKey],
    );
    return r.rows[0];
  }

  async findBackupById(id: string): Promise<BackupJobRecord | undefined> {
    const r = await this.db.query<BackupJobRecord>(
      `SELECT id, "idempotencyKey", status, "storageKey", "byteLength", "errorCode",
              "createdAt"::text, "updatedAt"::text
       FROM "BackupJob" WHERE id=$1`,
      [id],
    );
    return r.rows[0];
  }

  async createBackupJob(idempotencyKey: string): Promise<BackupJobRecord> {
    const r = await this.db.query<BackupJobRecord>(
      `INSERT INTO "BackupJob" ("idempotencyKey", status)
       VALUES ($1,'queued')
       RETURNING id, "idempotencyKey", status, "storageKey", "byteLength", "errorCode",
                 "createdAt"::text, "updatedAt"::text`,
      [idempotencyKey],
    );
    return r.rows[0];
  }

  async updateBackupJob(
    id: string,
    patch: {
      status: BackupJobStatus;
      storageKey?: string | null;
      byteLength?: number | null;
      errorCode?: string | null;
    },
  ): Promise<BackupJobRecord> {
    const r = await this.db.query<BackupJobRecord>(
      `UPDATE "BackupJob"
       SET status=$2,
           "storageKey"=COALESCE($3,"storageKey"),
           "byteLength"=COALESCE($4,"byteLength"),
           "errorCode"=$5,
           "updatedAt"=CURRENT_TIMESTAMP
       WHERE id=$1
       RETURNING id, "idempotencyKey", status, "storageKey", "byteLength", "errorCode",
                 "createdAt"::text, "updatedAt"::text`,
      [id, patch.status, patch.storageKey ?? null, patch.byteLength ?? null, patch.errorCode ?? null],
    );
    return r.rows[0];
  }

  async createRestoreTestResult(input: {
    sourceBackupJobId: string;
    targetEnvironment: 'isolated';
    status: RestoreTestResult['status'];
    startedAt: string;
    targetDatabase?: string | null;
  }): Promise<RestoreTestResult> {
    const r = await this.db.query<RestoreTestResult>(
      `INSERT INTO "RestoreTestResult"
         ("sourceBackupJobId","targetEnvironment",status,"startedAt","checks","targetDatabase")
       VALUES ($1,$2,$3,$4::timestamptz,'{}'::jsonb,$5)
       RETURNING id, "sourceBackupJobId", "targetEnvironment", status,
                 "startedAt"::text, "completedAt"::text, checks, "errorCode", "targetDatabase"`,
      [
        input.sourceBackupJobId,
        input.targetEnvironment,
        input.status,
        input.startedAt,
        input.targetDatabase ?? null,
      ],
    );
    return r.rows[0];
  }

  async finishRestoreTestResult(
    id: string,
    patch: {
      status: RestoreTestResult['status'];
      completedAt: string;
      checks: Record<string, unknown>;
      errorCode: string | null;
      targetDatabase: string | null;
    },
  ): Promise<RestoreTestResult> {
    const r = await this.db.query<RestoreTestResult>(
      `UPDATE "RestoreTestResult"
       SET status=$2,
           "completedAt"=$3::timestamptz,
           checks=$4::jsonb,
           "errorCode"=$5,
           "targetDatabase"=$6
       WHERE id=$1
       RETURNING id, "sourceBackupJobId", "targetEnvironment", status,
                 "startedAt"::text, "completedAt"::text, checks, "errorCode", "targetDatabase"`,
      [
        id,
        patch.status,
        patch.completedAt,
        JSON.stringify(patch.checks),
        patch.errorCode,
        patch.targetDatabase,
      ],
    );
    return r.rows[0];
  }

  async findRestoreTestResult(id: string): Promise<RestoreTestResult | undefined> {
    const r = await this.db.query<RestoreTestResult>(
      `SELECT id, "sourceBackupJobId", "targetEnvironment", status,
              "startedAt"::text, "completedAt"::text, checks, "errorCode", "targetDatabase"
       FROM "RestoreTestResult" WHERE id=$1`,
      [id],
    );
    return r.rows[0];
  }

  async upsertThreatReview(input: ThreatReviewDraft) {
    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM "ThreatReview" WHERE title=$1',
      [input.title],
    );
    if (existing.rows[0]) {
      const updated = await this.db.query(
        `UPDATE "ThreatReview"
         SET category=$2, severity=$3, status=$4, "abuseCase"=$5, mitigation=$6, "updatedAt"=CURRENT_TIMESTAMP
         WHERE title=$1
         RETURNING id, title, category, severity, status, "abuseCase", mitigation`,
        [input.title, input.category, input.severity, input.status, input.abuseCase, input.mitigation],
      );
      return updated.rows[0];
    }
    const created = await this.db.query(
      `INSERT INTO "ThreatReview" (title, category, severity, status, "abuseCase", mitigation)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, title, category, severity, status, "abuseCase", mitigation`,
      [input.title, input.category, input.severity, input.status, input.abuseCase, input.mitigation],
    );
    return created.rows[0];
  }

  async listThreatReviews() {
    const r = await this.db.query(
      `SELECT id, title, category, severity, status, "abuseCase", mitigation
       FROM "ThreatReview" ORDER BY "createdAt" DESC LIMIT 100`,
    );
    return r.rows;
  }

  async countPrimaryUsers(): Promise<number> {
    const r = await this.db.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM "User"');
    return Number(r.rows[0]?.c ?? 0);
  }
}
