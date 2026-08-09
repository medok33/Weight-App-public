import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AIUsageLogRecord, ConversationRecord, MessageRecord } from '../domain/ai-assistant.types';
import type { MessageFeedbackRating, MessageFeedbackRecord } from '../domain/ai-feedback.types';

@Injectable()
export class AIAssistantRepository {
  private readonly prompts = new Map<string, unknown>();

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  save(key: string, value: unknown) {
    this.prompts.set(key, value);
    return value;
  }

  find(key: string) {
    return this.prompts.get(key);
  }

  async control() {
    const result = await this.db.query<{ enabled: boolean; updatedAt: string }>(
      'SELECT enabled,"updatedAt" FROM "AIControl" WHERE id=1',
    );
    return result.rows[0] ?? { enabled: true, updatedAt: new Date().toISOString() };
  }

  async session(hash: string) {
    const result = await this.db.query<{ userId: string; role: string; mfaVerifiedAt: Date | null }>(
      'SELECT "userId",role,"mfaVerifiedAt" FROM "Session" WHERE "tokenHash"=$1 AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP',
      [hash],
    );
    return result.rows[0];
  }

  /** Authoritative MFA path: active OwnerMfaCredential (legacy OwnerMfaChallenge is not trusted). */
  async mfa(userId: string) {
    const result = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM "OwnerMfaCredential"
         WHERE "userId"=$1 AND status='ACTIVE' AND "disabledAt" IS NULL
       ) ok`,
      [userId],
    );
    return result.rows[0]?.ok === true;
  }

  async setControl(userId: string, enabled: boolean) {
    await this.db.query(
      'INSERT INTO "AIControl" (id,enabled,"updatedBy") VALUES (1,$1,$2) ON CONFLICT (id) DO UPDATE SET enabled=EXCLUDED.enabled,"updatedBy"=EXCLUDED."updatedBy","updatedAt"=CURRENT_TIMESTAMP',
      [enabled, userId],
    );
    await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)', [
      userId,
      'ai.kill_switch.updated',
      JSON.stringify({ enabled }),
    ]);
    return this.control();
  }

  async createConversation(userId: string, title?: string): Promise<ConversationRecord> {
    const result = await this.db.query<{ id: string; userId: string; title: string | null; createdAt: string }>(
      `INSERT INTO "AIConversation" ("userId", title) VALUES ($1, $2)
       RETURNING id, "userId", title, "createdAt"::text`,
      [userId, title ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('CONVERSATION_CREATE_FAILED');
    return { id: row.id, userId: row.userId, title: row.title ?? undefined, createdAt: row.createdAt };
  }

  async listConversations(userId: string): Promise<ConversationRecord[]> {
    const result = await this.db.query<{ id: string; userId: string; title: string | null; createdAt: string }>(
      `SELECT id, "userId", title, "createdAt"::text FROM "AIConversation"
       WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      title: row.title ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationRecord | null> {
    const result = await this.db.query<{ id: string; userId: string; title: string | null; createdAt: string }>(
      `SELECT id, "userId", title, "createdAt"::text FROM "AIConversation"
       WHERE id = $1 AND "userId" = $2`,
      [conversationId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, userId: row.userId, title: row.title ?? undefined, createdAt: row.createdAt };
  }

  async addMessage(conversationId: string, role: string, content: string): Promise<MessageRecord> {
    const result = await this.db.query<{ id: string; conversationId: string; role: string; content: string; createdAt: string }>(
      `INSERT INTO "AIMessage" ("conversationId", role, content)
       VALUES ($1, $2, $3)
       RETURNING id, "conversationId", role, content, "createdAt"::text`,
      [conversationId, role, content],
    );
    const row = result.rows[0];
    if (!row) throw new Error('MESSAGE_CREATE_FAILED');
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as MessageRecord['role'],
      content: row.content,
      createdAt: row.createdAt,
    };
  }

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    const result = await this.db.query<{ id: string; conversationId: string; role: string; content: string; createdAt: string }>(
      `SELECT id, "conversationId", role, content, "createdAt"::text
       FROM "AIMessage" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as MessageRecord['role'],
      content: row.content,
      createdAt: row.createdAt,
    }));
  }

  async hasPremiumEntitlement(userId: string): Promise<boolean> {
    try {
      const result = await this.db.query<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM "Entitlement"
           WHERE "userId" = $1
             AND key = 'ai.premium'
             AND status = 'active'
             AND "startsAt" <= CURRENT_TIMESTAMP
             AND ("endsAt" IS NULL OR "endsAt" > CURRENT_TIMESTAMP)
         ) ok`,
        [userId],
      );
      return result.rows[0]?.ok === true;
    } catch {
      return false;
    }
  }

  async getDailyUsage(userId: string, day = new Date()) {
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const result = await this.db.query<{
      requestCount: string;
      promptTokens: string;
      completionTokens: string;
      models: string | null;
    }>(
      `SELECT COUNT(*)::text AS "requestCount",
              COALESCE(SUM("promptTokens"), 0)::text AS "promptTokens",
              COALESCE(SUM("completionTokens"), 0)::text AS "completionTokens",
              string_agg(DISTINCT model, ',') AS models
       FROM "AIUsageLog"
       WHERE "userId" = $1
         AND COALESCE(success, true) = true
         AND "errorCode" IS NULL
         AND "createdAt" >= $2::timestamptz
         AND "createdAt" < $3::timestamptz`,
      [userId, dayStart.toISOString(), dayEnd.toISOString()],
    );

    const row = result.rows[0];
    return {
      userId,
      date: dayStart.toISOString().slice(0, 10),
      requestCount: Number(row?.requestCount ?? 0),
      promptTokens: Number(row?.promptTokens ?? 0),
      completionTokens: Number(row?.completionTokens ?? 0),
      models: row?.models ? row.models.split(',').filter(Boolean) : [],
    };
  }

  async logUsage(input: {
    userId: string;
    conversationId?: string;
    providerId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    tier?: string;
    thinkingEnabled?: boolean;
    estimatedCost?: number;
    latencyMs?: number;
    success?: boolean;
    topic?: string;
    errorCode?: string;
  }): Promise<AIUsageLogRecord> {
    const totalTokens = input.totalTokens ?? input.promptTokens + input.completionTokens;
    const result = await this.db.query<{
      id: string;
      userId: string;
      conversationId: string | null;
      providerId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      createdAt: string;
    }>(
      `INSERT INTO "AIUsageLog"
         ("userId", "conversationId", "providerId", model, "promptTokens", "completionTokens",
          topic, "errorCode", tier, "thinkingEnabled", "totalTokens", "estimatedCost", "latencyMs", success)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, "userId", "conversationId", "providerId", model, "promptTokens", "completionTokens", "createdAt"::text`,
      [
        input.userId,
        input.conversationId ?? null,
        input.providerId,
        input.model,
        input.promptTokens,
        input.completionTokens,
        input.topic ?? null,
        input.errorCode ?? null,
        input.tier ?? null,
        input.thinkingEnabled ?? false,
        totalTokens,
        input.estimatedCost ?? 0,
        input.latencyMs ?? 0,
        input.success ?? true,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('AI_USAGE_LOG_FAILED');
    return {
      id: row.id,
      userId: row.userId,
      conversationId: row.conversationId ?? undefined,
      providerId: row.providerId,
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      createdAt: row.createdAt,
    };
  }

  async getMessageForUser(userId: string, messageId: string): Promise<MessageRecord | null> {
    const result = await this.db.query<{
      id: string;
      conversationId: string;
      role: string;
      content: string;
      createdAt: string;
    }>(
      `SELECT m.id, m."conversationId", m.role, m.content, m."createdAt"::text
       FROM "AIMessage" m
       JOIN "AIConversation" c ON c.id = m."conversationId"
       WHERE m.id = $1 AND c."userId" = $2`,
      [messageId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as MessageRecord['role'],
      content: row.content,
      createdAt: row.createdAt,
    };
  }

  async upsertMessageFeedback(
    userId: string,
    messageId: string,
    rating: MessageFeedbackRating,
  ): Promise<MessageFeedbackRecord> {
    const result = await this.db.query<{
      id: string;
      userId: string;
      messageId: string;
      rating: string;
      createdAt: string;
    }>(
      `INSERT INTO "AIMessageFeedback" ("userId", "messageId", rating)
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId", "messageId") DO UPDATE SET rating = EXCLUDED.rating, "createdAt" = CURRENT_TIMESTAMP
       RETURNING id, "userId", "messageId", rating, "createdAt"::text`,
      [userId, messageId, rating],
    );
    const row = result.rows[0];
    if (!row) throw new Error('FEEDBACK_SAVE_FAILED');
    return {
      id: row.id,
      userId: row.userId,
      messageId: row.messageId,
      rating: row.rating as MessageFeedbackRating,
      createdAt: row.createdAt,
    };
  }

  async listMessageFeedback(userId: string, messageIds: string[]): Promise<Record<string, MessageFeedbackRating>> {
    if (messageIds.length === 0) return {};
    const result = await this.db.query<{ messageId: string; rating: string }>(
      `SELECT "messageId", rating FROM "AIMessageFeedback"
       WHERE "userId" = $1 AND "messageId" = ANY($2::uuid[])`,
      [userId, messageIds],
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.messageId, row.rating as MessageFeedbackRating]),
    );
  }

  async getUsageMetrics(userId?: string) {
    const params: unknown[] = [];
    const filter = userId ? 'WHERE "userId" = $1' : '';
    if (userId) params.push(userId);
    const result = await this.db.query<{ requestCount: string; errorCount: string }>(
      `SELECT COUNT(*)::text AS "requestCount",
              COUNT(*) FILTER (WHERE "errorCode" IS NOT NULL OR model = 'intent-filter')::text AS "errorCount"
       FROM "AIUsageLog" ${filter}`,
      params,
    );
    const row = result.rows[0];
    return {
      requestCount: Number(row?.requestCount ?? 0),
      errorCount: Number(row?.errorCount ?? 0),
    };
  }

  async getFeedbackMetrics(userId?: string) {
    const params: unknown[] = [];
    const filter = userId ? 'WHERE "userId" = $1' : '';
    if (userId) params.push(userId);
    const result = await this.db.query<{ thumbsUp: string; thumbsDown: string }>(
      `SELECT COUNT(*) FILTER (WHERE rating = 'up')::text AS "thumbsUp",
              COUNT(*) FILTER (WHERE rating = 'down')::text AS "thumbsDown"
       FROM "AIMessageFeedback" ${filter}`,
      params,
    );
    const row = result.rows[0];
    return {
      thumbsUp: Number(row?.thumbsUp ?? 0),
      thumbsDown: Number(row?.thumbsDown ?? 0),
    };
  }

  async getRecentUserMessages(userId: string | undefined, limit: number): Promise<string[]> {
    const params: unknown[] = [limit];
    const filter = userId ? 'AND c."userId" = $2' : '';
    if (userId) params.push(userId);
    const result = await this.db.query<{ content: string }>(
      `SELECT m.content
       FROM "AIMessage" m
       JOIN "AIConversation" c ON c.id = m."conversationId"
       WHERE m.role = 'user' ${filter}
       ORDER BY m."createdAt" DESC
       LIMIT $1`,
      params,
    );
    return result.rows.map((row) => row.content);
  }
}
