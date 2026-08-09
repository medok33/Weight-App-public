import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { BetaFeedbackInput, BetaFeedbackRecord } from '../domain/retention.types';
import type { EngagementState, NotificationPreferences } from '../domain/retention.types';

@Injectable()
export class RetentionRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async listCompletedSteps(userId: string): Promise<Array<{ stepKey: string; completedAt: string }>> {
    const result = await this.db.query<{ stepKey: string; completedAt: string }>(
      `SELECT "stepKey", "completedAt"::text AS "completedAt"
       FROM "BetaOnboardingProgress"
       WHERE "userId"=$1
       ORDER BY "completedAt" ASC`,
      [userId],
    );
    return result.rows;
  }

  async completeStep(userId: string, stepKey: string): Promise<{ stepKey: string; completedAt: string }> {
    const result = await this.db.query<{ stepKey: string; completedAt: string }>(
      `INSERT INTO "BetaOnboardingProgress" ("userId", "stepKey")
       VALUES ($1::uuid, $2)
       ON CONFLICT ("userId", "stepKey") DO UPDATE SET "stepKey"=EXCLUDED."stepKey"
       RETURNING "stepKey", "completedAt"::text AS "completedAt"`,
      [userId, stepKey],
    );
    return result.rows[0];
  }

  async findFeedbackByIdempotency(idempotencyKey: string): Promise<BetaFeedbackRecord | null> {
    const result = await this.db.query<BetaFeedbackRecord>(
      `SELECT id, "userId", category, message, "idempotencyKey", "createdAt"::text AS "createdAt"
       FROM "BetaFeedback" WHERE "idempotencyKey"=$1`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async insertFeedback(input: BetaFeedbackInput): Promise<BetaFeedbackRecord> {
    const result = await this.db.query<BetaFeedbackRecord>(
      `INSERT INTO "BetaFeedback" ("userId", category, message, "idempotencyKey")
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING id, "userId", category, message, "idempotencyKey", "createdAt"::text AS "createdAt"`,
      [input.userId, input.category, input.message, input.idempotencyKey],
    );
    return result.rows[0];
  }
  async preferences(userId: string): Promise<NotificationPreferences> {
    const result = await this.db.query<NotificationPreferences>(`SELECT "userId",channels,"quietHoursStart","quietHoursEnd",timezone,"categoryOpts" FROM "NotificationPreference" WHERE "userId"=$1::uuid`, [userId]);
    return result.rows[0] ?? { userId, channels: { in_app: true, email: true, push: false }, categoryOpts: {} };
  }
  async savePreferences(input: NotificationPreferences) {
    const result = await this.db.query<NotificationPreferences>(`INSERT INTO "NotificationPreference" ("userId",channels,"quietHoursStart","quietHoursEnd",timezone,"categoryOpts") VALUES ($1::uuid,$2::jsonb,$3,$4,$5,$6::jsonb) ON CONFLICT ("userId") DO UPDATE SET channels=EXCLUDED.channels,"quietHoursStart"=EXCLUDED."quietHoursStart","quietHoursEnd"=EXCLUDED."quietHoursEnd",timezone=EXCLUDED.timezone,"categoryOpts"=EXCLUDED."categoryOpts","updatedAt"=CURRENT_TIMESTAMP RETURNING "userId",channels,"quietHoursStart","quietHoursEnd",timezone,"categoryOpts"`, [input.userId, JSON.stringify(input.channels), input.quietHoursStart ?? null, input.quietHoursEnd ?? null, input.timezone ?? null, JSON.stringify(input.categoryOpts ?? {})]);
    return result.rows[0];
  }
  async enqueue(userId: string, category: string, title: string, body: string, key: string) {
    const notification = (await this.db.query<{ id: string }>(`INSERT INTO "Notification" ("userId",category,title,body,"dedupeKey") VALUES ($1::uuid,$2,$3,$4,$5) ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id,category,title,body,"dedupeKey",status`, [userId, category, title, body, key])).rows[0] ?? null;
    if (notification) await this.db.query(`INSERT INTO "NotificationOutbox" ("notificationId",channel,status,"availableAt") VALUES ($1::uuid,'in_app','PENDING',CURRENT_TIMESTAMP) ON CONFLICT ("notificationId") DO NOTHING`, [notification.id]);
    return notification;
  }
  async getNotification(userId: string, notificationId: string) {
    return (await this.db.query(`SELECT id,"userId",category,title,body,status FROM "Notification" WHERE id=$1::uuid AND "userId"=$2::uuid`, [notificationId, userId])).rows[0] ?? null;
  }
  async countAttempts(notificationId: string, channel: string) {
    return Number((await this.db.query<{ count: string }>(`SELECT count(*)::text AS count FROM "DeliveryAttempt" WHERE "notificationId"=$1::uuid AND channel=$2`, [notificationId, channel])).rows[0]?.count ?? 0);
  }
  async recordAttempt(notificationId: string, channel: string, status: string, attempt: number, errorCode: string | null) {
    return (await this.db.query(`INSERT INTO "DeliveryAttempt" ("notificationId",channel,status,attempt,"errorCode") VALUES ($1::uuid,$2,$3,$4,$5) RETURNING id,status,attempt,"errorCode"`, [notificationId, channel, status, attempt, errorCode])).rows[0];
  }
  async markDelivered(notificationId: string) {
    await this.db.query(`UPDATE "Notification" SET status='SENT' WHERE id=$1::uuid`, [notificationId]);
  }
  async listInAppInbox(userId: string) {
    return (await this.db.query(`SELECT id,category,title,body,status,"scheduledFor","createdAt" FROM "Notification" WHERE "userId"=$1::uuid AND status IN ('QUEUED','SENT') ORDER BY "createdAt" DESC`, [userId])).rows;
  }
  async claimOutboxBatch(limit: number) {
    return (await this.db.query(`WITH candidates AS (
      SELECT id FROM "NotificationOutbox" WHERE status='PENDING' AND "availableAt" <= CURRENT_TIMESTAMP
      ORDER BY "availableAt" ASC FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE "NotificationOutbox" o SET status='PROCESSING',"updatedAt"=CURRENT_TIMESTAMP
      FROM candidates WHERE o.id=candidates.id
      RETURNING o.id,o."notificationId",o.channel,o.attempts`, [limit])).rows;
  }
  async outboxContext(outboxId: string) {
    return (await this.db.query(`SELECT o.id AS "outboxId",o."notificationId",o.channel,o.attempts,n."userId",n.category,
      EXISTS(SELECT 1 FROM "User" u WHERE u.id=n."userId" AND u.status='ACTIVE') AS "userActive"
      FROM "NotificationOutbox" o JOIN "Notification" n ON n.id=o."notificationId" WHERE o.id=$1::uuid`, [outboxId])).rows[0] ?? null;
  }
  async deferOutbox(outboxId: string, availableAt: Date) {
    await this.db.query(`UPDATE "NotificationOutbox" SET status='PENDING',"availableAt"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [outboxId, availableAt]);
  }
  async completeOutbox(outboxId: string) { await this.db.query(`UPDATE "NotificationOutbox" SET status='DONE',"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [outboxId]); }
  async failOutbox(outboxId: string, attempts: number, error: string, retryable: boolean) {
    const dead = !retryable || attempts >= 3;
    const availableAt = new Date(Date.now() + Math.pow(2, attempts) * 1000);
    await this.db.query(`UPDATE "NotificationOutbox" SET status=$2,attempts=$3,"lastError"=$4,"availableAt"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [outboxId, dead ? 'DEAD' : 'PENDING', attempts, error, availableAt]);
    return dead;
  }
  async engagement(userId: string): Promise<EngagementState> {
    const result = await this.db.query<EngagementState>(`SELECT "userId","successfulDaysTotal","bestStreakDays","currentStreakDays",paused,"lastActiveOn"::text AS "lastActiveOn","remindersEnabled" FROM "EngagementState" WHERE "userId"=$1::uuid`, [userId]);
    return result.rows[0] ?? { userId, successfulDaysTotal: 0, bestStreakDays: 0, currentStreakDays: 0, paused: false, remindersEnabled: true };
  }
  async saveEngagement(state: EngagementState) {
    await this.db.query(`INSERT INTO "EngagementState" ("userId","successfulDaysTotal","bestStreakDays","currentStreakDays",paused,"lastActiveOn","remindersEnabled") VALUES ($1::uuid,$2,$3,$4,$5,$6::date,$7) ON CONFLICT ("userId") DO UPDATE SET "successfulDaysTotal"=EXCLUDED."successfulDaysTotal","bestStreakDays"=EXCLUDED."bestStreakDays","currentStreakDays"=EXCLUDED."currentStreakDays",paused=EXCLUDED.paused,"lastActiveOn"=EXCLUDED."lastActiveOn","remindersEnabled"=EXCLUDED."remindersEnabled"`, [state.userId,state.successfulDaysTotal,state.bestStreakDays,state.currentStreakDays,state.paused,state.lastActiveOn ?? null,state.remindersEnabled]);
    return state;
  }
}
