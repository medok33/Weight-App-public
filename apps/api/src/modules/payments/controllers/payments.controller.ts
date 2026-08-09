import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { CsrfExempt } from '../../auth/decorators/csrf-exempt.decorator';
import { PaymentsService } from '../application/payments.service';
import { parseCheckoutSessionRequest } from '../dto/payments.request.dto';

@Public()
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly service: PaymentsService) {}

  private token(request: { headers?: Record<string, string | string[]> }, header?: string) {
    const raw = header ?? request?.headers?.['x-session-token'] ?? request?.headers?.authorization;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value?.replace(/^Bearer\s+/i, '');
  }

  @Get('offers')
  offers() {
    return this.service.listActive();
  }

  @Post('offers')
  async upsert(
    @Headers('x-session-token') token: string | undefined,
    @Body()
    body: {
      key?: unknown;
      name?: unknown;
      amountMinor?: unknown;
      currency?: unknown;
      interval?: unknown;
      active?: unknown;
      metadata?: unknown;
    },
  ) {
    if (
      typeof body?.key !== 'string' ||
      typeof body.name !== 'string' ||
      typeof body.amountMinor !== 'number' ||
      typeof body.currency !== 'string' ||
      typeof body.interval !== 'string' ||
      typeof body.active !== 'boolean'
    ) {
      throw new BadRequestException('PRODUCT_OFFER_INVALID');
    }
    try {
      return await this.service.upsertBySession(token, {
        key: body.key,
        name: body.name,
        amountMinor: body.amountMinor,
        currency: body.currency,
        interval: body.interval as 'month',
        active: body.active,
        metadata: (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, unknown>,
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'PRODUCT_OFFER_INVALID') throw new BadRequestException(e.message);
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('checkout')
  async checkout(@Req() request: { headers?: Record<string, string | string[]> }, @Body() body: Record<string, unknown>) {
    try {
      return await this.service.createCheckout(this.token(request), parseCheckoutSessionRequest(body));
    } catch (e) {
      const code = e instanceof Error ? e.message : 'CHECKOUT_UNAUTHORIZED';
      if (code === 'CHECKOUT_REQUEST_INVALID') throw new BadRequestException(code);
      if (code === 'OFFER_NOT_FOUND') throw new NotFoundException(code);
      if (code === 'CHECKOUT_TOKEN_MISSING') throw new BadRequestException(code);
      if (code === 'CHECKOUT_SESSION_MISSING') throw new UnauthorizedException(code);
      throw new UnauthorizedException('CHECKOUT_UNAUTHORIZED');
    }
  }

  @Get('status/:id')
  async getPayment(
    @Req() request: { headers?: Record<string, string | string[]> },
    @Headers('x-session-token') header: string | undefined,
    @Param('id') id: string,
  ) {
    try {
      return await this.service.getPayment(this.token(request, header), id);
    } catch (e) {
      const code = e instanceof Error ? e.message : 'PAYMENT_INVALID';
      if (code === 'PAYMENT_NOT_FOUND') throw new NotFoundException(code);
      if (code === 'PAYMENT_FORBIDDEN') throw new UnauthorizedException(code);
      if (code === 'PAYMENT_TOKEN_MISSING') throw new BadRequestException(code);
      throw new UnauthorizedException('PAYMENT_SESSION_MISSING');
    }
  }

  @CsrfExempt({
    reason: 'Payment provider server-to-server webhook',
    trustMechanism: 'x-webhook-signature HMAC verification (PAYMENT_WEBHOOK_SECRET)',
  })
  @Post('webhook')
  async webhook(@Headers('x-webhook-signature') signature: string | undefined, @Body() body: Record<string, unknown>) {
    try {
      return await this.service.handleWebhook(signature, JSON.stringify(body), body);
    } catch (e) {
      const code = e instanceof Error ? e.message : 'WEBHOOK_INVALID';
      if (code === 'WEBHOOK_SIGNATURE_INVALID') throw new UnauthorizedException(code);
      if (code === 'WEBHOOK_EVENT_INVALID' || code === 'PAYMENT_NOT_FOUND' || code === 'PAYMENT_INVALID_TRANSITION') {
        throw new BadRequestException(code);
      }
      throw new BadRequestException('WEBHOOK_INVALID');
    }
  }

  @Post('receipt')
  async receipt(
    @Body() body: { paymentId?: unknown; provider?: unknown; status?: unknown; idempotencyKey?: unknown },
  ) {
    if (
      typeof body?.paymentId !== 'string' ||
      body.provider !== 'npd' ||
      body.status !== 'queued' ||
      typeof body.idempotencyKey !== 'string'
    ) {
      throw new BadRequestException('RECEIPT_REQUEST_INVALID');
    }
    try {
      return await this.service.createReceipt({
        paymentId: body.paymentId,
        provider: 'npd',
        status: 'queued',
        idempotencyKey: body.idempotencyKey,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'RECEIPT_INVALID';
      if (code === 'PAYMENT_NOT_FOUND') throw new NotFoundException(code);
      if (code === 'RECEIPT_PAYMENT_NOT_SETTLED' || code === 'RECEIPT_REQUEST_INVALID') throw new BadRequestException(code);
      throw new BadRequestException('RECEIPT_INVALID');
    }
  }

  @Post('refunds')
  async requestRefund(
    @Req() request: { headers?: Record<string, string | string[]> },
    @Headers('x-session-token') header: string | undefined,
    @Body()
    body: {
      paymentId?: unknown;
      amountMinor?: unknown;
      currency?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
    },
  ) {
    if (
      typeof body?.paymentId !== 'string' ||
      typeof body.amountMinor !== 'number' ||
      typeof body.currency !== 'string' ||
      typeof body.reason !== 'string' ||
      typeof body.idempotencyKey !== 'string'
    ) {
      throw new BadRequestException('REFUND_REQUEST_INVALID');
    }
    try {
      return await this.service.requestRefund(this.token(request, header), {
        paymentId: body.paymentId,
        amountMinor: body.amountMinor,
        currency: body.currency,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'REFUND_INVALID';
      if (code === 'PAYMENT_NOT_FOUND') throw new NotFoundException(code);
      if (
        code === 'REFUND_REQUEST_INVALID' ||
        code === 'REFUND_PAYMENT_NOT_SETTLED' ||
        code === 'REFUND_AMOUNT_EXCEEDS_PAYMENT' ||
        code === 'REFUND_CURRENCY_MISMATCH' ||
        code === 'REFUND_TOKEN_MISSING'
      ) {
        throw new BadRequestException(code);
      }
      if (code === 'REFUND_FORBIDDEN') throw new UnauthorizedException(code);
      throw new UnauthorizedException('REFUND_SESSION_MISSING');
    }
  }

  @Get('refunds/pending')
  async pendingRefunds(
    @Req() request: { headers?: Record<string, string | string[]> },
    @Headers('x-session-token') header: string | undefined,
  ) {
    try {
      return await this.service.listPendingRefunds(this.token(request, header));
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('refunds/:id/decision')
  async decideRefund(
    @Req() request: { headers?: Record<string, string | string[]> },
    @Headers('x-session-token') header: string | undefined,
    @Param('id') id: string,
    @Body() body: { decision?: unknown; decisionNote?: unknown },
  ) {
    if (body?.decision !== 'approve' && body?.decision !== 'reject') {
      throw new BadRequestException('REFUND_DECISION_INVALID');
    }
    try {
      return await this.service.decideRefund(this.token(request, header), {
        refundId: id,
        decision: body.decision,
        decisionNote: typeof body.decisionNote === 'string' ? body.decisionNote : undefined,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'REFUND_DECISION_FAILED';
      if (code === 'REFUND_NOT_FOUND') throw new NotFoundException(code);
      if (code === 'REFUND_DECISION_INVALID' || code === 'REFUND_INVALID_TRANSITION') throw new BadRequestException(code);
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('reconcile')
  async reconcile(
    @Req() request: { headers?: Record<string, string | string[]> },
    @Headers('x-session-token') header: string | undefined,
    @Query('pendingFailAfterMinutes') pendingFailAfterMinutes?: string,
  ) {
    try {
      const minutes = pendingFailAfterMinutes ? Number(pendingFailAfterMinutes) : 60;
      if (!Number.isFinite(minutes) || minutes < 1) throw new BadRequestException('RECONCILIATION_INVALID');
      return await this.service.runReconciliation(this.token(request, header), minutes);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }
}
