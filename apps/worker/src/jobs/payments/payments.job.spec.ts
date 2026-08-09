import { describe, expect, it } from 'vitest';
import { createCommerceReconciliationJob } from './payments.job';
import { processCommerceReconciliationJob } from './payments.processor';

describe('commerce reconciliation job', () => {
  it('marks stale pending payments failed', () => {
    const job = createCommerceReconciliationJob(60, 'reconcile-001');
    const out = processCommerceReconciliationJob(job, [
      { paymentId: 'p1', status: 'pending', ageMinutes: 90 },
      { paymentId: 'p2', status: 'succeeded', ageMinutes: 120 },
      { paymentId: 'p3', status: 'pending', ageMinutes: 10 },
    ]);
    expect(out.markedFailed).toBe(1);
    expect(out.results[0].action).toBe('mark_failed');
    expect(out.results[1].action).toBe('noop');
    expect(out.results[2].action).toBe('noop');
  });

  it('rejects invalid job payload', () => {
    expect(() => createCommerceReconciliationJob(0, 'bad')).toThrow('RECONCILIATION_JOB_INVALID');
  });
});
