import type { CommerceReconciliationJob } from './payments.job';

export type ReconciliationCandidate = {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  ageMinutes: number;
};

function decide(
  candidate: ReconciliationCandidate,
  pendingFailAfterMinutes: number,
): { paymentId: string; action: 'noop' | 'mark_failed'; reason: string } {
  if (!candidate.paymentId) throw new Error('RECONCILIATION_CANDIDATE_INVALID');
  if (candidate.status !== 'pending') {
    return { paymentId: candidate.paymentId, action: 'noop', reason: 'already_terminal' };
  }
  if (candidate.ageMinutes < pendingFailAfterMinutes) {
    return { paymentId: candidate.paymentId, action: 'noop', reason: 'too_fresh' };
  }
  return { paymentId: candidate.paymentId, action: 'mark_failed', reason: 'stale_pending' };
}

/** Processor applies reconciliation policy per candidate; idempotent for terminal rows. */
export function processCommerceReconciliationJob(
  job: CommerceReconciliationJob,
  candidates: ReconciliationCandidate[],
) {
  const results = candidates.map((candidate) => decide(candidate, job.pendingFailAfterMinutes));
  return {
    idempotencyKey: job.idempotencyKey,
    processed: results.length,
    markedFailed: results.filter((r) => r.action === 'mark_failed').length,
    results,
    status: 'completed' as const,
  };
}
