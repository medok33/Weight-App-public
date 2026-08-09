import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AlertRule, ObservabilityEvent, OwnerNotification, DeployRun } from '../domain/observability.types';

@Injectable()
export class ObservabilityRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async session(tokenHash: string) {
    const result = await this.db.query<{ userId: string; role: string; mfaVerifiedAt: Date | null }>(
      'SELECT "userId",role,"mfaVerifiedAt" FROM "Session" WHERE "tokenHash"=$1 AND "revokedAt" IS NULL AND "expiresAt">now()',
      [tokenHash],
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

  async events(): Promise<ObservabilityEvent[]> {
    const result = await this.db.query<ObservabilityEvent>(
      'SELECT id,action,metadata,"createdAt" FROM "OwnerAuditEvent" ORDER BY "createdAt" DESC LIMIT 100',
    );
    return result.rows;
  }

  async upsertAlertRule(rule: Omit<AlertRule, 'id'> & { id?: string }): Promise<AlertRule> {
    if (rule.id) {
      const updated = await this.db.query<AlertRule>(
        `UPDATE "AlertRule"
         SET name=$2, metric=$3, threshold=$4, comparator=$5, enabled=$6, "updatedAt"=CURRENT_TIMESTAMP
         WHERE id=$1
         RETURNING id, name, metric, threshold, comparator, enabled`,
        [rule.id, rule.name, rule.metric, rule.threshold, rule.comparator, rule.enabled],
      );
      if (updated.rows[0]) return updated.rows[0];
    }
    const existing = await this.db.query<AlertRule>(
      'SELECT id, name, metric, threshold, comparator, enabled FROM "AlertRule" WHERE name=$1',
      [rule.name],
    );
    if (existing.rows[0]) {
      const updated = await this.db.query<AlertRule>(
        `UPDATE "AlertRule"
         SET metric=$2, threshold=$3, comparator=$4, enabled=$5, "updatedAt"=CURRENT_TIMESTAMP
         WHERE name=$1
         RETURNING id, name, metric, threshold, comparator, enabled`,
        [rule.name, rule.metric, rule.threshold, rule.comparator, rule.enabled],
      );
      return updated.rows[0];
    }
    const created = await this.db.query<AlertRule>(
      `INSERT INTO "AlertRule" (name, metric, threshold, comparator, enabled)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, metric, threshold, comparator, enabled`,
      [rule.name, rule.metric, rule.threshold, rule.comparator, rule.enabled],
    );
    return created.rows[0];
  }

  async listAlertRules(): Promise<AlertRule[]> {
    const result = await this.db.query<AlertRule>(
      'SELECT id, name, metric, threshold, comparator, enabled FROM "AlertRule" ORDER BY name ASC',
    );
    return result.rows;
  }

  async createNotification(ruleId: string, message: string): Promise<OwnerNotification> {
    const result = await this.db.query<OwnerNotification>(
      `INSERT INTO "OwnerNotification" ("ruleId", message, delivered)
       VALUES ($1,$2,true)
       RETURNING id, "ruleId" as "ruleId", message, delivered, "createdAt"::text`,
      [ruleId, message],
    );
    return result.rows[0];
  }

  async listNotifications(): Promise<OwnerNotification[]> {
    const result = await this.db.query<OwnerNotification>(
      `SELECT id, "ruleId" as "ruleId", message, delivered, "createdAt"::text
       FROM "OwnerNotification"
       ORDER BY "createdAt" DESC
       LIMIT 50`,
    );
    return result.rows;
  }

  async createDeployRun(input: {
    action: DeployRun['action'];
    status: DeployRun['status'];
    migrationName: string;
    notes?: string;
    actorUserId?: string | null;
  }): Promise<DeployRun> {
    const result = await this.db.query<DeployRun>(
      `INSERT INTO "DeployRun" (action, status, "migrationName", notes, "actorUserId")
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, action, status, "migrationName", notes, "actorUserId",
                 "createdAt"::text, "completedAt"::text`,
      [input.action, input.status, input.migrationName, input.notes ?? null, input.actorUserId ?? null],
    );
    return result.rows[0];
  }

  async completeDeployRun(id: string, status: DeployRun['status']): Promise<DeployRun> {
    const result = await this.db.query<DeployRun>(
      `UPDATE "DeployRun"
       SET status=$2, "completedAt"=CURRENT_TIMESTAMP
       WHERE id=$1
       RETURNING id, action, status, "migrationName", notes, "actorUserId",
                 "createdAt"::text, "completedAt"::text`,
      [id, status],
    );
    return result.rows[0];
  }

  async listDeployRuns(): Promise<DeployRun[]> {
    const result = await this.db.query<DeployRun>(
      `SELECT id, action, status, "migrationName", notes, "actorUserId",
              "createdAt"::text, "completedAt"::text
       FROM "DeployRun" ORDER BY "createdAt" DESC LIMIT 50`,
    );
    return result.rows;
  }

  /** STEP_169: aggregate counts without PII / prompt payloads. */
  async betaMetricsSnapshot(): Promise<{
    productEvents: number;
    safetyEscalations: number;
    aiCostUsd: number;
    aiFailures: number;
    requestFailures: number;
  }> {
    const product = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "OwnerAuditEvent"
       WHERE action LIKE 'product.%' OR action LIKE 'beta.%'`,
    );
    const safety = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "OwnerAuditEvent"
       WHERE action LIKE 'safety.%' OR action LIKE 'eligibility.blocked%'`,
    );
    const failures = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "OwnerAuditEvent"
       WHERE action LIKE '%.failed' OR action LIKE '%.error%'`,
    );
    let aiCostUsd = 0;
    let aiFailures = 0;
    try {
      const ai = await this.db.query<{ cost: string; fails: string }>(
        `SELECT COALESCE(SUM("estimatedCost"),0)::text AS cost,
                COUNT(*) FILTER (WHERE success = false)::text AS fails
         FROM "AIUsageLog"`,
      );
      aiCostUsd = Number(ai.rows[0]?.cost ?? 0);
      aiFailures = Number(ai.rows[0]?.fails ?? 0);
    } catch {
      aiCostUsd = 0;
      aiFailures = 0;
    }
    return {
      productEvents: Number(product.rows[0]?.c ?? 0),
      safetyEscalations: Number(safety.rows[0]?.c ?? 0),
      aiCostUsd,
      aiFailures,
      requestFailures: Number(failures.rows[0]?.c ?? 0),
    };
  }
}
