import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { transitionPayment } from '../domain/payments.policy';
import type { PaymentStatus } from '../domain/payment-models.types';
import type { ProductOffer } from '../domain/payments.types';
import type { RefundLifecycleStatus, RefundRecord } from '../domain/refund.types';
import { applyRefundDecision } from '../domain/refund.policy';
import { decideReconciliation } from '../domain/reconciliation.policy';

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async listActive() {
    const r = await this.db.query<ProductOffer>(
      'SELECT key,name,"amountMinor",currency,interval,active,metadata,"updatedAt" FROM "ProductOffer" WHERE active=true ORDER BY "amountMinor",key',
    );
    return r.rows;
  }

  async session(hash: string) {
    const r = await this.db.query<{ userId: string; role: string; mfaVerifiedAt: Date | null }>(
      'SELECT "userId",role,"mfaVerifiedAt" FROM "Session" WHERE "tokenHash"=$1 AND "revokedAt" IS NULL AND "expiresAt">now()',
      [hash],
    );
    return r.rows[0];
  }

  /** Authoritative MFA path: active OwnerMfaCredential (legacy OwnerMfaChallenge is not trusted). */
  async mfa(userId: string) {
    const r = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM "OwnerMfaCredential"
         WHERE "userId"=$1 AND status='ACTIVE' AND "disabledAt" IS NULL
       ) ok`,
      [userId],
    );
    return r.rows[0]?.ok === true;
  }

  async upsert(userId: string, offer: Omit<ProductOffer, 'updatedAt'>) {
    await this.db.query(
      'INSERT INTO "ProductOffer" (key,name,"amountMinor",currency,interval,active,metadata,"updatedBy") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,"amountMinor"=EXCLUDED."amountMinor",currency=EXCLUDED.currency,interval=EXCLUDED.interval,active=EXCLUDED.active,metadata=EXCLUDED.metadata,"updatedBy"=EXCLUDED."updatedBy","updatedAt"=now()',
      [
        offer.key,
        offer.name,
        offer.amountMinor,
        offer.currency,
        offer.interval,
        offer.active,
        JSON.stringify(offer.metadata),
        userId,
      ],
    );
    await this.db.query(
      'INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)',
      [userId, 'payments.product_offer.updated', JSON.stringify({ key: offer.key, amountMinor: offer.amountMinor, currency: offer.currency })],
    );
    const r = await this.db.query<ProductOffer>(
      'SELECT key,name,"amountMinor",currency,interval,active,metadata,"updatedAt" FROM "ProductOffer" WHERE key=$1',
      [offer.key],
    );
    return r.rows[0];
  }

  async checkout(userId: string, offerKey: string, idempotencyKey: string) {
    const scopedKey = `${userId}:${idempotencyKey}`;
    const r = await this.db.query<{ id: string; offerKey: string; amountMinor: number; currency: string }>(
      `WITH offer AS (SELECT key,"amountMinor",currency FROM "ProductOffer" WHERE key=$1 AND active=true),
       inserted AS (
         INSERT INTO "Payment" ("userId","offerKey",provider,"providerPaymentId",status,"amountMinor",currency,metadata)
         SELECT $2,offer.key,'checkout',$3,'pending',offer."amountMinor",offer.currency,'{}'::jsonb FROM offer
         ON CONFLICT (provider,"providerPaymentId") DO NOTHING
         RETURNING id,"offerKey","amountMinor",currency
       )
       SELECT id,"offerKey","amountMinor",currency FROM inserted
       UNION ALL
       SELECT id,"offerKey","amountMinor",currency FROM "Payment" WHERE provider='checkout' AND "providerPaymentId"=$3
       LIMIT 1`,
      [offerKey, userId, scopedKey],
    );
    return r.rows[0];
  }

  async getPaymentForUser(paymentId: string, userId: string) {
    const r = await this.db.query<{
      id: string;
      userId: string;
      offerKey: string | null;
      status: PaymentStatus;
      amountMinor: number;
      currency: string;
      createdAt: Date;
    }>('SELECT id,"userId","offerKey",status,"amountMinor",currency,"createdAt" FROM "Payment" WHERE id=$1', [paymentId]);
    const row = r.rows[0];
    if (!row) throw new Error('PAYMENT_NOT_FOUND');
    if (row.userId !== userId) throw new Error('PAYMENT_FORBIDDEN');
    return row;
  }

  async webhook(event: {
    provider: string;
    eventId: string;
    paymentId: string;
    status: string;
    payload: Record<string, unknown>;
  }) {
    const payment = await this.db.query<{ status: PaymentStatus }>('SELECT status FROM "Payment" WHERE id=$1', [
      event.paymentId,
    ]);
    if (!payment.rows[0]) throw new Error('PAYMENT_NOT_FOUND');
    const next = transitionPayment(payment.rows[0].status, event.status as PaymentStatus);
    const inserted = await this.db.query<{ id: string }>(
      'INSERT INTO "PaymentEvent" ("paymentId",provider,type,"providerEventId",payload) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (provider,"providerEventId") DO NOTHING RETURNING id',
      [event.paymentId, event.provider, `payment.${event.status}`, event.eventId, JSON.stringify(event.payload)],
    );
    if (!inserted.rows[0]) return { accepted: true, duplicate: true };
    await this.db.query('UPDATE "Payment" SET status=$1,"updatedAt"=now() WHERE id=$2', [next, event.paymentId]);
    return { accepted: true, duplicate: false };
  }

  async receipt(paymentId: string, idempotencyKey: string) {
    const r = await this.db.query<{ id: string; status: PaymentStatus }>('SELECT id,status FROM "Payment" WHERE id=$1', [
      paymentId,
    ]);
    if (!r.rows[0]) throw new Error('PAYMENT_NOT_FOUND');
    if (r.rows[0].status !== 'succeeded') throw new Error('RECEIPT_PAYMENT_NOT_SETTLED');
    return { paymentId: r.rows[0].id, provider: 'npd' as const, status: 'queued' as const, idempotencyKey };
  }

  async requestRefund(input: {
    userId: string;
    paymentId: string;
    amountMinor: number;
    currency: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<RefundRecord> {
    const payment = await this.db.query<{ userId: string; status: string; amountMinor: number; currency: string }>(
      'SELECT "userId",status,"amountMinor",currency FROM "Payment" WHERE id=$1',
      [input.paymentId],
    );
    if (!payment.rows[0]) throw new Error('PAYMENT_NOT_FOUND');
    if (payment.rows[0].userId !== input.userId) throw new Error('REFUND_FORBIDDEN');
    if (payment.rows[0].status !== 'succeeded') throw new Error('REFUND_PAYMENT_NOT_SETTLED');
    if (input.amountMinor > payment.rows[0].amountMinor) throw new Error('REFUND_AMOUNT_EXCEEDS_PAYMENT');
    if (input.currency !== payment.rows[0].currency) throw new Error('REFUND_CURRENCY_MISMATCH');

    const existing = await this.db.query<RefundRecord>(
      `SELECT id,"paymentId","amountMinor",currency,status,reason,
              "requestedByUserId","decidedByUserId","decidedAt","decisionNote","idempotencyKey"
       FROM "Refund" WHERE "idempotencyKey"=$1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) return existing.rows[0];

    const inserted = await this.db.query<RefundRecord>(
      `INSERT INTO "Refund" ("paymentId","amountMinor",currency,status,reason,metadata,"requestedByUserId","idempotencyKey")
       VALUES ($1,$2,$3,'requested',$4,'{}'::jsonb,$5,$6)
       RETURNING id,"paymentId","amountMinor",currency,status,reason,
                 "requestedByUserId","decidedByUserId","decidedAt","decisionNote","idempotencyKey"`,
      [input.paymentId, input.amountMinor, input.currency, input.reason, input.userId, input.idempotencyKey],
    );
    return inserted.rows[0];
  }

  async decideRefund(input: {
    ownerUserId: string;
    refundId: string;
    decision: 'approve' | 'reject';
    decisionNote?: string;
  }): Promise<RefundRecord> {
    const current = await this.db.query<RefundRecord>(
      `SELECT id,"paymentId","amountMinor",currency,status,reason,
              "requestedByUserId","decidedByUserId","decidedAt","decisionNote","idempotencyKey"
       FROM "Refund" WHERE id=$1`,
      [input.refundId],
    );
    if (!current.rows[0]) throw new Error('REFUND_NOT_FOUND');
    const next = applyRefundDecision(current.rows[0].status as RefundLifecycleStatus, input.decision);
    const finalStatus: RefundLifecycleStatus = input.decision === 'approve' ? 'succeeded' : next;
    const updated = await this.db.query<RefundRecord>(
      `UPDATE "Refund"
       SET status=$1,"decidedByUserId"=$2,"decidedAt"=now(),"decisionNote"=$3,"updatedAt"=now()
       WHERE id=$4
       RETURNING id,"paymentId","amountMinor",currency,status,reason,
                 "requestedByUserId","decidedByUserId","decidedAt","decisionNote","idempotencyKey"`,
      [finalStatus, input.ownerUserId, input.decisionNote ?? null, input.refundId],
    );
    await this.db.query(
      'INSERT INTO "OwnerAuditEvent" ("userId",action,metadata) VALUES ($1,$2,$3::jsonb)',
      [
        input.ownerUserId,
        'payments.refund.decision',
        JSON.stringify({ refundId: input.refundId, decision: input.decision, status: finalStatus }),
      ],
    );
    return updated.rows[0];
  }

  async listPendingRefunds() {
    const r = await this.db.query<RefundRecord>(
      `SELECT id,"paymentId","amountMinor",currency,status,reason,
              "requestedByUserId","decidedByUserId","decidedAt","decisionNote","idempotencyKey"
       FROM "Refund" WHERE status='requested' ORDER BY "createdAt" ASC LIMIT 100`,
    );
    return r.rows;
  }

  async reconcileStalePending(pendingFailAfterMinutes = 60) {
    const r = await this.db.query<{ id: string; status: PaymentStatus; ageMinutes: number }>(
      `SELECT id,status,EXTRACT(EPOCH FROM (now()-"createdAt"))/60 AS "ageMinutes"
       FROM "Payment" WHERE status='pending' ORDER BY "createdAt" ASC LIMIT 100`,
    );
    const results = [];
    for (const row of r.rows) {
      const decision = decideReconciliation(
        { paymentId: row.id, status: row.status, ageMinutes: Number(row.ageMinutes) },
        pendingFailAfterMinutes,
      );
      if (decision.action === 'mark_failed') {
        await this.db.query('UPDATE "Payment" SET status=$1,"updatedAt"=now() WHERE id=$2 AND status=$3', [
          'failed',
          row.id,
          'pending',
        ]);
      }
      results.push(decision);
    }
    return results;
  }
}
