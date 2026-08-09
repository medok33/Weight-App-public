import { Body, Controller, Get, Headers, Inject, Param, Post, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { CsrfExempt } from '../../auth/decorators/csrf-exempt.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { IntegrationsService } from '../application/integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private readonly service: IntegrationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.id);
  }
  @Get('consents')
  consents(@CurrentUser() user: RequestUser) { return this.service.listConsents(user.id); }

  @Post('consents/grant')
  grantConsent(@CurrentUser() user: RequestUser, @Body() body: { providerId?: string; dataCategory?: string; direction?: 'READ' | 'WRITE'; purpose?: string; consentVersion?: string; source?: string }) {
    return this.run(() => this.service.grantConsent(user.id, body));
  }

  @Post('consents/:providerId/revoke')
  revokeConsent(@CurrentUser() user: RequestUser, @Param('providerId') providerId: string, @Body() body: { dataCategory?: string }) {
    return this.run(() => this.service.revokeConsent(user.id, providerId, body.dataCategory));
  }

  @Post(':providerId/connect')
  connect(
    @CurrentUser() user: RequestUser,
    @Param('providerId') providerId: string,
    @Body() body: { consentVersion?: string },
  ) {
    return this.run(() => this.service.connect(user.id, providerId, body.consentVersion ?? '', body));
  }

  @Post('connections/:connectionId/disconnect')
  disconnect(@CurrentUser() user: RequestUser, @Param('connectionId') id: string) {
    return this.run(() => this.service.disconnect(user.id, id));
  }

  @Post('connections/:connectionId/sync')
  sync(@CurrentUser() user: RequestUser, @Param('connectionId') id: string) {
    return this.run(() => this.service.sync(user.id, id));
  }

  @Public()
  @CsrfExempt({
    reason: 'Integration provider server-to-server webhook',
    trustMechanism: 'x-signature shared-secret verification (INTEGRATION_WEBHOOK_SECRET)',
  })
  @Post(':providerId/webhook')
  webhook(
    @Param('providerId') providerId: string,
    @Body() body: { eventId?: string; raw?: string },
    @Headers('x-signature') signature?: string,
  ) {
    return this.run(() =>
      this.service.webhook(
        providerId,
        body.eventId ?? '',
        body.raw ?? '',
        signature ?? '',
        process.env.INTEGRATION_WEBHOOK_SECRET ?? 'test-webhook-secret',
      ),
    );
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INTEGRATION_FAILED';
      if (message === 'INTEGRATION_FORBIDDEN') throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }
}
