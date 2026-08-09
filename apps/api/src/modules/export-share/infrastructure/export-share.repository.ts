import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { transitionExportJob, validateExportJobDraft } from '../domain/export-share.policy';
import type { ExportJobDraft, ExportJobRecord, ExportJobStatus } from '../domain/export-share.types';
import type { ShareLinkRecord } from '../domain/export-document.types';

@Injectable()
export class ExportShareRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async enqueue(draft: ExportJobDraft): Promise<ExportJobRecord> {
    const data = validateExportJobDraft(draft);
    const existing = await this.findByIdempotency(data.idempotencyKey);
    if (existing) return existing;
    const inserted = await this.db.query<ExportJobRecord>(
      `INSERT INTO "ExportJob" ("userId",type,status,"idempotencyKey",payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING id,"userId",type,status,"idempotencyKey",payload,result,"errorCode"`,
      [data.userId, data.type, data.status, data.idempotencyKey, JSON.stringify(data.payload)],
    );
    return inserted.rows[0];
  }

  async findByIdempotency(idempotencyKey: string) {
    const existing = await this.db.query<ExportJobRecord>(
      'SELECT id,"userId",type,status,"idempotencyKey",payload,result,"errorCode" FROM "ExportJob" WHERE "idempotencyKey"=$1',
      [idempotencyKey],
    );
    return existing.rows[0];
  }

  async findByIdForUser(jobId: string, userId: string) {
    const r = await this.db.query<ExportJobRecord>(
      'SELECT id,"userId",type,status,"idempotencyKey",payload,result,"errorCode" FROM "ExportJob" WHERE id=$1',
      [jobId],
    );
    const row = r.rows[0];
    if (!row) throw new Error('EXPORT_JOB_NOT_FOUND');
    if (row.userId !== userId) throw new Error('EXPORT_FORBIDDEN');
    return row;
  }

  async listForUser(userId: string, limit = 20) {
    const r = await this.db.query<ExportJobRecord>(
      `SELECT id,"userId",type,status,"idempotencyKey",payload,result,"errorCode"
       FROM "ExportJob" WHERE "userId"=$1
       ORDER BY "createdAt" DESC LIMIT $2`,
      [userId, limit],
    );
    return r.rows;
  }

  async transition(
    jobId: string,
    userId: string,
    next: ExportJobStatus,
    patch?: { result?: Record<string, unknown>; errorCode?: string | null },
  ) {
    const current = await this.db.query<{ status: ExportJobStatus; userId: string }>(
      'SELECT status,"userId" FROM "ExportJob" WHERE id=$1',
      [jobId],
    );
    if (!current.rows[0]) throw new Error('EXPORT_JOB_NOT_FOUND');
    if (current.rows[0].userId !== userId) throw new Error('EXPORT_FORBIDDEN');
    const status = transitionExportJob(current.rows[0].status, next);
    const updated = await this.db.query<ExportJobRecord>(
      `UPDATE "ExportJob"
       SET status=$1,
           result=CASE WHEN $2::jsonb IS NULL THEN result ELSE $2::jsonb END,
           "errorCode"=CASE WHEN $3::text IS NULL THEN "errorCode" ELSE $3 END,
           "updatedAt"=now()
       WHERE id=$4
       RETURNING id,"userId",type,status,"idempotencyKey",payload,result,"errorCode"`,
      [
        status,
        patch?.result ? JSON.stringify(patch.result) : null,
        patch && 'errorCode' in patch ? patch.errorCode : null,
        jobId,
      ],
    );
    return updated.rows[0];
  }

  async createShareLink(input: {
    userId: string;
    exportJobId: string;
    ttlMinutes: number;
  }): Promise<ShareLinkRecord> {
    const token = createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 48);
    const r = await this.db.query<ShareLinkRecord>(
      `INSERT INTO "ShareLink" (token,"exportJobId","userId","expiresAt")
       VALUES ($1,$2,$3, now() + ($4 * interval '1 minute'))
       RETURNING id,token,"exportJobId","userId","expiresAt"::text,"revokedAt"::text,"createdAt"::text`,
      [token, input.exportJobId, input.userId, String(input.ttlMinutes)],
    );
    return r.rows[0];
  }

  async findShareLinkByToken(token: string): Promise<ShareLinkRecord | undefined> {
    const r = await this.db.query<ShareLinkRecord>(
      `SELECT id,token,"exportJobId","userId","expiresAt"::text,"revokedAt"::text,"createdAt"::text
       FROM "ShareLink" WHERE token=$1`,
      [token],
    );
    return r.rows[0];
  }

  async revokeShareLink(linkId: string, userId: string): Promise<ShareLinkRecord> {
    const r = await this.db.query<ShareLinkRecord>(
      `UPDATE "ShareLink" SET "revokedAt"=now()
       WHERE id=$1 AND "userId"=$2
       RETURNING id,token,"exportJobId","userId","expiresAt"::text,"revokedAt"::text,"createdAt"::text`,
      [linkId, userId],
    );
    if (!r.rows[0]) throw new Error('SHARE_LINK_NOT_FOUND');
    return r.rows[0];
  }
}
