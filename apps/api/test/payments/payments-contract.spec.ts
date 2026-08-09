import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCheckoutSessionRequest } from '../../src/modules/payments/dto/payments.request.dto';
import { validateRefundRequest, applyRefundDecision } from '../../src/modules/payments/domain/refund.policy';
import { decideReconciliation } from '../../src/modules/payments/domain/reconciliation.policy';
import { transitionExportJob } from '../../src/modules/export-share/domain/export-share.policy';

describe('STEP_140 payment contract/integration suite', () => {
  it('keeps checkout contract strict', () => {
    expect(
      parseCheckoutSessionRequest({
        offerKey: 'pro-monthly',
        returnUrl: 'https://example.test/payments',
        idempotencyKey: 'idem-contract-01',
      }).returnUrl,
    ).toContain('/payments');
  });

  it('covers refund request → decision contract', () => {
    const request = validateRefundRequest({
      paymentId: '22222222-2222-4222-8222-222222222222',
      amountMinor: 49900,
      currency: 'RUB',
      reason: 'Changed mind',
      idempotencyKey: 'refund-contract-01',
    });
    expect(applyRefundDecision('requested', 'approve')).toBe('approved');
    expect(request.currency).toBe('RUB');
  });

  it('covers reconciliation contract', () => {
    expect(decideReconciliation({ paymentId: 'p', status: 'pending', ageMinutes: 61 }).reason).toBe('stale_pending');
  });

  it('covers export job transition contract used after payments spine', () => {
    expect(transitionExportJob('queued', 'running')).toBe('running');
  });

  it('documents refund and export migrations', () => {
    const refundSql = readFileSync(resolve(process.cwd(), 'prisma/migrations/149_refund-request-flow/migration.sql'), 'utf8');
    const exportSql = readFileSync(resolve(process.cwd(), 'prisma/migrations/150_export-share/migration.sql'), 'utf8');
    expect(refundSql).toContain('idempotencyKey');
    expect(exportSql).toContain('CREATE TABLE IF NOT EXISTS "ExportJob"');
  });
});
