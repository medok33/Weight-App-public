export type ReconciliationCandidate = {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  ageMinutes: number;
};

export type ReconciliationAction = 'noop' | 'mark_failed' | 'mark_succeeded';

export type ReconciliationResult = {
  paymentId: string;
  action: ReconciliationAction;
  reason: string;
};

/** Stale pending checkouts older than threshold are marked failed (idempotent). */
export function decideReconciliation(
  candidate: ReconciliationCandidate,
  pendingFailAfterMinutes = 60,
): ReconciliationResult {
  if (!candidate.paymentId) throw new Error('RECONCILIATION_CANDIDATE_INVALID');
  if (candidate.status !== 'pending') {
    return { paymentId: candidate.paymentId, action: 'noop', reason: 'already_terminal' };
  }
  if (candidate.ageMinutes < pendingFailAfterMinutes) {
    return { paymentId: candidate.paymentId, action: 'noop', reason: 'too_fresh' };
  }
  return { paymentId: candidate.paymentId, action: 'mark_failed', reason: 'stale_pending' };
}
