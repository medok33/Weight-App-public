import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { validateOffer } from '../domain/payments.policy';
import { validateCheckoutInput, validateWebhookEvent, verifyWebhookSignature } from '../domain/payment-provider.policy';
import { validateReceiptRequest } from '../domain/receipt.policy';
import { validateRefundDecision, validateRefundRequest } from '../domain/refund.policy';
import { PaymentsRepository } from '../infrastructure/payments.repository';
import type { ProductOffer } from '../domain/payments.types';

@Injectable()
export class PaymentsService {
  constructor(@Inject(PaymentsRepository) private readonly repository: PaymentsRepository) {}

  listActive() {
    return this.repository.listActive();
  }

  async upsertBySession(token: string | undefined, input: Omit<ProductOffer, 'updatedAt'>) {
    const owner = await this.requireOwner(token);
    return this.repository.upsert(owner.userId, validateOffer(input));
  }

  async createCheckout(
    token: string | undefined,
    input: { offerKey: string; returnUrl: string; idempotencyKey: string },
  ) {
    if (!token) throw new Error('CHECKOUT_TOKEN_MISSING');
    const s = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!s) throw new Error('CHECKOUT_SESSION_MISSING');
    const data = validateCheckoutInput(input);
    const payment = await this.repository.checkout(s.userId, data.offerKey, data.idempotencyKey);
    if (!payment) throw new Error('OFFER_NOT_FOUND');
    const sep = data.returnUrl.includes('?') ? '&' : '?';
    return {
      id: payment.id,
      offerKey: payment.offerKey,
      provider: 'checkout' as const,
      status: 'pending' as const,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      confirmationUrl: `${data.returnUrl}${sep}checkout=${encodeURIComponent(payment.id)}`,
    };
  }

  async getPayment(token: string | undefined, paymentId: string) {
    if (!token) throw new Error('PAYMENT_TOKEN_MISSING');
    const s = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!s) throw new Error('PAYMENT_SESSION_MISSING');
    const payment = await this.repository.getPaymentForUser(paymentId, s.userId);
    const outcome =
      payment.status === 'succeeded' ? 'success' : payment.status === 'failed' || payment.status === 'cancelled' ? 'failure' : 'pending';
    return { ...payment, outcome };
  }

  async handleWebhook(signature: string | undefined, rawBody: string, input: Record<string, unknown>) {
    if (!signature || !verifyWebhookSignature(rawBody, signature, process.env.PAYMENT_WEBHOOK_SECRET ?? 'local-webhook-secret')) {
      throw new Error('WEBHOOK_SIGNATURE_INVALID');
    }
    return this.repository.webhook(validateWebhookEvent(input));
  }

  async createReceipt(input: {
    paymentId: string;
    provider: 'npd';
    status: 'queued';
    idempotencyKey: string;
  }) {
    return this.repository.receipt(validateReceiptRequest(input).paymentId, input.idempotencyKey);
  }

  async requestRefund(
    token: string | undefined,
    input: { paymentId: string; amountMinor: number; currency: string; reason: string; idempotencyKey: string },
  ) {
    if (!token) throw new Error('REFUND_TOKEN_MISSING');
    const s = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!s) throw new Error('REFUND_SESSION_MISSING');
    const data = validateRefundRequest(input);
    return this.repository.requestRefund({ userId: s.userId, ...data });
  }

  async decideRefund(
    token: string | undefined,
    input: { refundId: string; decision: 'approve' | 'reject'; decisionNote?: string },
  ) {
    const owner = await this.requireOwner(token);
    const data = validateRefundDecision(input);
    return this.repository.decideRefund({
      ownerUserId: owner.userId,
      refundId: data.refundId,
      decision: data.decision,
      decisionNote: data.decisionNote,
    });
  }

  async listPendingRefunds(token: string | undefined) {
    await this.requireOwner(token);
    return this.repository.listPendingRefunds();
  }

  async runReconciliation(token: string | undefined, pendingFailAfterMinutes = 60) {
    await this.requireOwner(token);
    return this.repository.reconcileStalePending(pendingFailAfterMinutes);
  }

  private async requireOwner(token: string | undefined) {
    if (!token) throw new Error('OWNER_ACCESS_FORBIDDEN');
    const s = await this.repository.session(createHash('sha256').update(token).digest('hex'));
    if (!s || s.role !== 'OWNER') {
      throw new Error('OWNER_ACCESS_FORBIDDEN');
    }
    return s;
  }
}
