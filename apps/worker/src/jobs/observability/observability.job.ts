export type ObservabilityJobPayload = { idempotencyKey: string; action: string; metadata: Record<string, unknown> };
export function createObservabilityJob(payload: ObservabilityJobPayload) { if (!payload.idempotencyKey || !payload.action) throw new Error('OBSERVABILITY_JOB_INVALID'); return payload; }
