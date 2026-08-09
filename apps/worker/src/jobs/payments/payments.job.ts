export type CommerceReconciliationJob = {
  pendingFailAfterMinutes: number;
  idempotencyKey: string;
};

export function createCommerceReconciliationJob(
  pendingFailAfterMinutes: number,
  idempotencyKey: string,
): CommerceReconciliationJob {
  if (!Number.isFinite(pendingFailAfterMinutes) || pendingFailAfterMinutes < 1) {
    throw new Error('RECONCILIATION_JOB_INVALID');
  }
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new Error('RECONCILIATION_JOB_INVALID');
  return { pendingFailAfterMinutes, idempotencyKey };
}
