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
