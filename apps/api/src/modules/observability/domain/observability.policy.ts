import type {
  AlertComparator,
  AlertRule,
  AnonymizedSeedUser,
  BetaMetricsBundle,
  BetaMetricsSnapshot,
  CriticalPathId,
  LoadSample,
  LoadTestSummary,
  LoadTestThresholds,
  MetricPoint,
  ObservabilityEvent,
  ObservabilityOperations,
  StagingSeedProfile,
  StructuredLogRecord,
  PublicMvpDeployInput,
  PublicMvpDeployPlan,
  PostReleaseCheck,
  PostReleaseCheckId,
  PostReleaseDecision,
} from './observability.types';

const REDACT_KEYS = new Set([
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'apiKey',
  'secret',
  'cookie',
  'session',
  'prompt',
  'cardNumber',
  'cvv',
]);

export function classifyEvents(events: ObservabilityEvent[]): ObservabilityOperations {
  return {
    jobs: events.filter((event) => /job|worker|queue/i.test(event.action)),
    errors: events.filter((event) => /error|failed|failure/i.test(event.action)),
    audit: events,
  };
}

/** Deep-redact sensitive keys; never log raw secrets. */
export function redactSensitive<T>(value: T): T {
  return redactValue(value, 0) as T;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return '[Truncated]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key) || /password|token|secret|authorization/i.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactValue(child, depth + 1);
    }
  }
  return out;
}

export function buildStructuredLog(
  level: StructuredLogRecord['level'],
  message: string,
  fields?: Record<string, unknown>,
  requestId?: string,
): StructuredLogRecord {
  if (!message.trim()) throw new Error('LOG_MESSAGE_INVALID');
  return {
    level,
    message: message.trim(),
    service: 'api',
    timestamp: new Date().toISOString(),
    requestId,
    fields: fields ? (redactSensitive(fields) as Record<string, unknown>) : undefined,
  };
}

export function evaluateAlert(rule: AlertRule, metrics: MetricPoint[]): boolean {
  if (!rule.enabled) return false;
  const point = metrics.find((metric) => metric.name === rule.metric);
  if (!point) return false;
  return compare(point.value, rule.threshold, rule.comparator);
}

function compare(value: number, threshold: number, comparator: AlertComparator): boolean {
  switch (comparator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    default:
      throw new Error('ALERT_COMPARATOR_INVALID');
  }
}

export function validateAlertRule(input: Omit<AlertRule, 'id'> & { id?: string }): Omit<AlertRule, 'id'> & { id?: string } {
  if (!input.name?.trim() || !input.metric?.trim()) throw new Error('ALERT_RULE_INVALID');
  if (!Number.isFinite(input.threshold)) throw new Error('ALERT_RULE_INVALID');
  if (!['gt', 'gte', 'lt', 'lte', 'eq'].includes(input.comparator)) throw new Error('ALERT_RULE_INVALID');
  return { ...input, name: input.name.trim(), metric: input.metric.trim() };
}

/** STEP_158: validate migrate/deploy/rollback runbook entry. */
export function validateDeployRunbookStep(input: {
  action: string;
  migrationName: string;
  notes?: string;
}): { action: 'migrate' | 'rollback' | 'deploy'; migrationName: string; notes?: string } {
  if (!['migrate', 'rollback', 'deploy'].includes(input.action)) throw new Error('DEPLOY_RUN_INVALID');
  if (!/^\d{3}_[a-z0-9-]+$/i.test(input.migrationName.trim())) throw new Error('DEPLOY_RUN_INVALID');
  return {
    action: input.action as 'migrate' | 'rollback' | 'deploy',
    migrationName: input.migrationName.trim(),
    notes: input.notes?.trim() || undefined,
  };
}

export function deployRollbackOrder(migrationNames: string[]): string[] {
  return [...migrationNames].sort().reverse();
}

export const CRITICAL_LOAD_PATHS: CriticalPathId[] = [
  'health.live',
  'health.ready',
  'auth.login',
  'dashboard.today',
  'meal.plan',
  'shopping.list',
  'export.job',
];

export const DEFAULT_LOAD_THRESHOLDS: LoadTestThresholds = {
  maxP95Ms: 1500,
  maxErrorRate: 0.05,
};

/** STEP_162: summarize load samples for one critical path. */
export function summarizeLoadSamples(
  path: CriticalPathId,
  samples: LoadSample[],
  thresholds: LoadTestThresholds = DEFAULT_LOAD_THRESHOLDS,
): LoadTestSummary {
  const scoped = samples.filter((s) => s.path === path);
  if (scoped.length === 0) throw new Error('LOAD_SAMPLES_EMPTY');
  const sorted = [...scoped].map((s) => s.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const p95Ms = sorted[Math.max(0, p95Index)]!;
  const errors = scoped.filter((s) => s.statusCode >= 500 || s.statusCode === 0).length;
  const errorRate = errors / scoped.length;
  return {
    path,
    count: scoped.length,
    p95Ms,
    errorRate: Number(errorRate.toFixed(4)),
    passed: p95Ms <= thresholds.maxP95Ms && errorRate <= thresholds.maxErrorRate,
  };
}

export function evaluateLoadSuite(
  samples: LoadSample[],
  thresholds: LoadTestThresholds = DEFAULT_LOAD_THRESHOLDS,
): { passed: boolean; summaries: LoadTestSummary[] } {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('LOAD_SAMPLES_EMPTY');
  const summaries = CRITICAL_LOAD_PATHS.filter((path) => samples.some((s) => s.path === path)).map((path) =>
    summarizeLoadSamples(path, samples, thresholds),
  );
  if (summaries.length === 0) throw new Error('LOAD_SAMPLES_EMPTY');
  return { passed: summaries.every((s) => s.passed), summaries };
}

/** STEP_164: staging seed must never carry real PII. */
export function anonymizeStagingSeed(input: StagingSeedProfile, index: number): AnonymizedSeedUser {
  if (!input.locale?.trim()) throw new Error('STAGING_SEED_INVALID');
  if (index < 0) throw new Error('STAGING_SEED_INVALID');
  const n = String(index + 1).padStart(3, '0');
  return {
    email: `staging.user${n}@example.invalid`,
    displayName: `Staging User ${n}`,
    locale: input.locale.trim(),
  };
}

export function assertStagingEnvironment(envName: string) {
  if (envName !== 'staging' && envName !== 'local-staging') throw new Error('STAGING_ENV_INVALID');
  return envName;
}

export function assertNotProductionSeedTarget(databaseName: string) {
  if (!databaseName || databaseName === 'weight_app' || /prod/i.test(databaseName)) {
    throw new Error('STAGING_SEED_PRIMARY_FORBIDDEN');
  }
  return databaseName;
}

/** STEP_169: aggregate product / safety / AI cost / failure metrics (no PII). */
export function collectBetaReleaseMetrics(input: {
  productEvents?: number;
  safetyEscalations?: number;
  aiCostUsd?: number;
  aiFailures?: number;
  requestFailures?: number;
}): BetaMetricsBundle {
  const snapshot: BetaMetricsSnapshot = {
    productEvents: nonNegInt(input.productEvents, 'BETA_METRICS_INVALID'),
    safetyEscalations: nonNegInt(input.safetyEscalations, 'BETA_METRICS_INVALID'),
    aiCostUsd: nonNegMoney(input.aiCostUsd, 'BETA_METRICS_INVALID'),
    aiFailures: nonNegInt(input.aiFailures, 'BETA_METRICS_INVALID'),
    requestFailures: nonNegInt(input.requestFailures, 'BETA_METRICS_INVALID'),
  };
  return {
    snapshot,
    metrics: [
      { name: 'product.events', value: snapshot.productEvents, unit: 'count' },
      { name: 'safety.escalations', value: snapshot.safetyEscalations, unit: 'count' },
      { name: 'ai.cost_usd', value: snapshot.aiCostUsd, unit: 'count' },
      { name: 'ai.failures', value: snapshot.aiFailures, unit: 'count' },
      { name: 'request.failures', value: snapshot.requestFailures, unit: 'count' },
    ],
  };
}

function nonNegInt(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(code);
  }
  return value;
}

function nonNegMoney(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(code);
  return Number(value.toFixed(6));
}

const SEMVER = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/i;
const COMMIT = /^[0-9a-f]{7,40}$/i;

/** STEP_173: plan public MVP deploy (production requires frozen RC semantics). */
export function planPublicMvpDeployment(input: PublicMvpDeployInput): PublicMvpDeployPlan {
  const version = input.version?.trim() ?? '';
  const commitSha = input.commitSha?.trim() ?? '';
  if (!SEMVER.test(version)) throw new Error('MVP_DEPLOY_VERSION_INVALID');
  if (!COMMIT.test(commitSha)) throw new Error('MVP_DEPLOY_COMMIT_INVALID');
  if (input.environment !== 'production' && input.environment !== 'staging') {
    throw new Error('MVP_DEPLOY_ENV_INVALID');
  }
  return {
    version,
    environment: input.environment,
    commitSha,
    executable: input.environment === 'staging',
    steps: [
      'preflight.health',
      'migrate.forward',
      'deploy.apps',
      'smoke.health_ready',
      'post.release.verify',
    ],
  };
}

const REQUIRED_POST_RELEASE: PostReleaseCheckId[] = [
  'health_live',
  'health_ready',
  'error_rate',
  'owner_rbac',
  'payments_webhook',
];

/** STEP_174: keep vs rollback — any failed required check → rollback. */
export function decidePostRelease(checks: PostReleaseCheck[]): PostReleaseDecision {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('POST_RELEASE_CHECKS_INVALID');
  const byId = new Map(checks.map((c) => [c.id, c]));
  const normalized: PostReleaseCheck[] = REQUIRED_POST_RELEASE.map((id) => {
    const found = byId.get(id);
    if (!found) return { id, ok: false, detail: 'missing' };
    return { id, ok: found.ok === true, detail: found.detail };
  });
  const failed = normalized.filter((c) => !c.ok).map((c) => c.id);
  const passed = failed.length === 0;
  return {
    passed,
    checks: normalized,
    failed,
    decision: passed ? 'keep' : 'rollback',
  };
}

