import type { ObservabilityJobPayload } from './observability.job';
export function processObservabilityJob(job: ObservabilityJobPayload) { return { idempotencyKey: job.idempotencyKey, status: 'recorded' as const, action: job.action }; }
