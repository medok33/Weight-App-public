import { describe, expect, it } from 'vitest';
import { createObservabilityJob } from './observability.job';
import { processObservabilityJob } from './observability.processor';
describe('observability job', () => { it('keeps idempotency key and records status', () => { const job = createObservabilityJob({ idempotencyKey: 'obs-1', action: 'worker.job.completed', metadata: {} }); expect(processObservabilityJob(job)).toMatchObject({ idempotencyKey: 'obs-1', status: 'recorded' }); }); });
