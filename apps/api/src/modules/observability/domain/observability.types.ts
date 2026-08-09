export type ObservabilityEvent = {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ObservabilityOperations = {
  jobs: ObservabilityEvent[];
  errors: ObservabilityEvent[];
  audit: ObservabilityEvent[];
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLogRecord = {
  level: LogLevel;
  message: string;
  service: string;
  timestamp: string;
  requestId?: string;
  fields?: Record<string, unknown>;
};

export type MetricPoint = {
  name: string;
  value: number;
  unit: 'count' | 'ms' | 'ratio';
};

export type TraceSpan = {
  name: string;
  durationMs: number;
  status: 'ok' | 'error';
};

export type ObservabilityDashboard = {
  metrics: MetricPoint[];
  traces: TraceSpan[];
  operations: ObservabilityOperations;
};

export type AlertComparator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export type AlertRule = {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  comparator: AlertComparator;
  enabled: boolean;
};

export type OwnerNotification = {
  id: string;
  ruleId: string;
  message: string;
  createdAt: string;
  delivered: boolean;
};

export type DeployAction = 'migrate' | 'rollback' | 'deploy';
export type DeployRunStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'rolled_back';

export type DeployRun = {
  id: string;
  action: DeployAction;
  status: DeployRunStatus;
  migrationName: string;
  notes: string | null;
  actorUserId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type DeployRunbookStep = {
  action: DeployAction;
  migrationName: string;
  notes?: string;
};

/** STEP_162 */
export type CriticalPathId =
  | 'health.live'
  | 'health.ready'
  | 'auth.login'
  | 'dashboard.today'
  | 'meal.plan'
  | 'shopping.list'
  | 'export.job';

export type LoadSample = {
  path: CriticalPathId;
  latencyMs: number;
  statusCode: number;
};

export type LoadTestThresholds = {
  maxP95Ms: number;
  maxErrorRate: number;
};

export type LoadTestSummary = {
  path: CriticalPathId;
  count: number;
  p95Ms: number;
  errorRate: number;
  passed: boolean;
};

/** STEP_164 */
export type StagingSeedProfile = {
  email: string;
  displayName: string;
  locale: string;
};

export type AnonymizedSeedUser = {
  email: string;
  displayName: string;
  locale: string;
};

/** STEP_169 */
export type BetaMetricsSnapshot = {
  productEvents: number;
  safetyEscalations: number;
  aiCostUsd: number;
  aiFailures: number;
  requestFailures: number;
};

export type BetaMetricsBundle = {
  metrics: MetricPoint[];
  snapshot: BetaMetricsSnapshot;
};

/** STEP_173 — public MVP deployment plan */
export type PublicMvpDeployInput = {
  version: string;
  environment: 'production' | 'staging';
  commitSha: string;
};

export type PublicMvpDeployPlan = {
  version: string;
  environment: 'production' | 'staging';
  commitSha: string;
  steps: string[];
  executable: boolean;
};

/** STEP_174 — post-release verification + rollback decision */
export type PostReleaseCheckId = 'health_live' | 'health_ready' | 'error_rate' | 'owner_rbac' | 'payments_webhook';

export type PostReleaseCheck = {
  id: PostReleaseCheckId;
  ok: boolean;
  detail?: string;
};

export type PostReleaseDecision = {
  decision: 'keep' | 'rollback';
  passed: boolean;
  checks: PostReleaseCheck[];
  failed: PostReleaseCheckId[];
};
