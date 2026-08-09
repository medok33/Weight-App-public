import { Inject, Injectable, Logger } from '@nestjs/common';
import { hasAdminAuthority } from '../../auth/domain/account-role.policy';
import type {
  AlertRule,
  LoadSample,
  MetricPoint,
  ObservabilityDashboard,
  OwnerNotification,
  StagingSeedProfile,
  StructuredLogRecord,
  TraceSpan,
  BetaMetricsSnapshot,
  PublicMvpDeployInput,
  PostReleaseCheck,
} from '../domain/observability.types';
import {
  buildStructuredLog,
  classifyEvents,
  evaluateAlert,
  evaluateLoadSuite,
  anonymizeStagingSeed,
  assertNotProductionSeedTarget,
  assertStagingEnvironment,
  collectBetaReleaseMetrics,
  decidePostRelease,
  planPublicMvpDeployment,
  redactSensitive,
  validateAlertRule,
  validateDeployRunbookStep,
} from '../domain/observability.policy';
import { ObservabilityRepository } from '../infrastructure/observability.repository';

export type ScaleReviewInput = { p95Ms?: number; queueAgeSeconds?: number; databaseCpuPercent?: number; jobFailureRate?: number };
export function scaleReviewSummary(input: ScaleReviewInput = {}) {
  const triggers = [
    input.p95Ms !== undefined && input.p95Ms > 500 ? 'API_P95_HIGH' : null,
    input.queueAgeSeconds !== undefined && input.queueAgeSeconds > 60 ? 'QUEUE_AGE_HIGH' : null,
    input.databaseCpuPercent !== undefined && input.databaseCpuPercent > 70 ? 'DATABASE_CPU_HIGH' : null,
    input.jobFailureRate !== undefined && input.jobFailureRate > 0.01 ? 'JOB_FAILURE_RATE_HIGH' : null,
  ].filter(Boolean) as string[];
  return { decision: 'DEFER_WITH_THRESHOLDS' as const, reassessmentRequired: triggers.length > 0, triggers };
}

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(@Inject(ObservabilityRepository) private readonly repository: ObservabilityRepository) {}

  assertOwnerOps(role: string) {
    if (!hasAdminAuthority(role)) throw new Error('OWNER_ACCESS_FORBIDDEN');
  }

  /** STEP_152: structured log with mandatory redaction. */
  structuredLog(
    level: StructuredLogRecord['level'],
    message: string,
    fields?: Record<string, unknown>,
    requestId?: string,
  ): StructuredLogRecord {
    const record = buildStructuredLog(level, message, fields, requestId);
    const line = JSON.stringify(redactSensitive(record));
    if (level === 'error') this.logger.error(line);
    else if (level === 'warn') this.logger.warn(line);
    else this.logger.log(line);
    return record;
  }

  async operationsForUser(userId: string, role: string) {
    void userId;
    this.assertOwnerOps(role);
    return classifyEvents(await this.repository.events());
  }

  /** STEP_153: metrics + traces + operations snapshot for owner dashboard. */
  async dashboardForUser(userId: string, role: string): Promise<ObservabilityDashboard> {
    const operations = await this.operationsForUser(userId, role);
    const metrics = this.buildMetrics(operations.jobs.length, operations.errors.length, operations.audit.length);
    const traces = this.buildTraces(operations.errors.length);
    this.structuredLog('info', 'observability.dashboard.served', {
      userId,
      jobs: metrics.find((m) => m.name === 'jobs.count')?.value,
      errors: metrics.find((m) => m.name === 'errors.count')?.value,
    });
    return { metrics, traces, operations };
  }

  /** STEP_154: create/update alert rule (idempotent by name). */
  async upsertAlertRule(role: string, input: Omit<AlertRule, 'id'> & { id?: string }) {
    this.assertOwnerOps(role);
    const rule = validateAlertRule(input);
    return this.repository.upsertAlertRule(rule);
  }

  async listAlertRules(role: string) {
    this.assertOwnerOps(role);
    return this.repository.listAlertRules();
  }

  async listNotifications(role: string) {
    this.assertOwnerOps(role);
    return this.repository.listNotifications();
  }

  /** Evaluate enabled rules against current metrics; append owner notifications when fired. */
  async evaluateAlerts(role: string): Promise<OwnerNotification[]> {
    this.assertOwnerOps(role);
    const dashboard = await this.dashboardForUser('system', role);
    const rules = await this.repository.listAlertRules();
    const fired: OwnerNotification[] = [];
    for (const rule of rules) {
      if (!evaluateAlert(rule, dashboard.metrics)) continue;
      const message = `Alert ${rule.name}: ${rule.metric} ${rule.comparator} ${rule.threshold}`;
      fired.push(await this.repository.createNotification(rule.id, message));
      this.structuredLog('warn', 'observability.alert.fired', { ruleId: rule.id, metric: rule.metric });
    }
    return fired;
  }

  /** STEP_158: record migrate/deploy/rollback runbook execution. */
  async recordDeployRun(
    role: string,
    actorUserId: string,
    input: { action: string; migrationName: string; notes?: string },
  ) {
    this.assertOwnerOps(role);
    const step = validateDeployRunbookStep(input);
    const running = await this.repository.createDeployRun({
      action: step.action,
      status: 'running',
      migrationName: step.migrationName,
      notes: step.notes,
      actorUserId,
    });
    return this.repository.completeDeployRun(running.id, 'succeeded');
  }

  async listDeployRuns(role: string) {
    this.assertOwnerOps(role);
    return this.repository.listDeployRuns();
  }

  /** STEP_162: evaluate load-test samples for critical paths (OWNER/ADMIN). */
  evaluateLoadTests(role: string, samples: LoadSample[]) {
    this.assertOwnerOps(role);
    return evaluateLoadSuite(samples);
  }
  scaleReviewSummary(input: ScaleReviewInput = {}) { return scaleReviewSummary(input); }

  /** STEP_164: build anonymized staging seed profiles (never production DB). */
  buildStagingSeed(role: string, envName: string, databaseName: string, profiles: StagingSeedProfile[]) {
    this.assertOwnerOps(role);
    assertStagingEnvironment(envName);
    assertNotProductionSeedTarget(databaseName);
    if (!Array.isArray(profiles) || profiles.length === 0) throw new Error('STAGING_SEED_INVALID');
    return profiles.map((profile, index) => anonymizeStagingSeed(profile, index));
  }

  /** STEP_169: product / safety / AI cost / failure metrics bundle. */
  collectBetaMetrics(role: string, input: Partial<BetaMetricsSnapshot>) {
    this.assertOwnerOps(role);
    return collectBetaReleaseMetrics(input);
  }

  async collectBetaMetricsFromStore(role: string) {
    this.assertOwnerOps(role);
    const snapshot = await this.repository.betaMetricsSnapshot();
    return collectBetaReleaseMetrics(snapshot);
  }

  /** STEP_173 */
  planPublicMvpDeploy(role: string, input: PublicMvpDeployInput) {
    this.assertOwnerOps(role);
    return planPublicMvpDeployment(input);
  }

  /** STEP_174 */
  postReleaseDecision(role: string, checks: PostReleaseCheck[]) {
    this.assertOwnerOps(role);
    return decidePostRelease(checks);
  }

  buildMetrics(jobCount: number, errorCount: number, auditCount: number): MetricPoint[] {
    const ratio = auditCount === 0 ? 0 : errorCount / auditCount;
    return [
      { name: 'jobs.count', value: jobCount, unit: 'count' },
      { name: 'errors.count', value: errorCount, unit: 'count' },
      { name: 'audit.count', value: auditCount, unit: 'count' },
      { name: 'errors.ratio', value: Number(ratio.toFixed(4)), unit: 'ratio' },
    ];
  }

  buildTraces(errorCount: number): TraceSpan[] {
    return [
      { name: 'observability.classify', durationMs: 2, status: 'ok' },
      { name: 'observability.metrics', durationMs: 1, status: 'ok' },
      { name: 'observability.errors', durationMs: errorCount > 0 ? 5 : 1, status: errorCount > 0 ? 'error' : 'ok' },
    ];
  }

  /** @deprecated Prefer operationsForUser with SessionAuthGuard */
  async operationsBySession(token?: string) {
    if (!token) throw new Error('OWNER_ACCESS_FORBIDDEN');
    const { createHash } = await import('node:crypto');
    const session = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!session || (!hasAdminAuthority(session.role))) {
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    return this.operationsForUser(session.userId, session.role);
  }
}
