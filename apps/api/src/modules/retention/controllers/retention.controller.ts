import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { RetentionService } from '../application/retention.service';

@Controller('retention')
export class RetentionController {
  constructor(@Inject(RetentionService) private readonly service: RetentionService) {}

  @Get('beta-onboarding')
  async onboarding(@CurrentUser() user: RequestUser) {
    return this.service.getOnboarding(user.id);
  }

  @Post('beta-onboarding/complete')
  async completeStep(@CurrentUser() user: RequestUser, @Body() body: { stepKey?: string }) {
    try {
      return await this.service.completeOnboardingStep(user.id, body?.stepKey ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'BETA_ONBOARDING_STEP_INVALID';
      throw new BadRequestException(message);
    }
  }

  @Post('beta-feedback')
  async feedback(
    @CurrentUser() user: RequestUser,
    @Body() body: { category?: string; message?: string; idempotencyKey?: string },
  ) {
    try {
      return await this.service.submitFeedback({
        userId: user.id,
        category: body?.category,
        message: body?.message,
        idempotencyKey: body?.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'BETA_FEEDBACK_INVALID';
      if (message === 'BETA_FEEDBACK_FORBIDDEN') throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }
  @Get('notifications/preferences')
  preferences(@CurrentUser() user: RequestUser) {
    return this.service.getNotificationPreferences(user.id);
  }

  @Post('notifications/preferences')
  setPreferences(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      channels?: { in_app?: boolean; email?: boolean; push?: boolean };
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
      timezone?: string | null;
      categoryOpts?: Record<string, boolean>;
    },
  ) {
    return this.service.setNotificationPreferences(user.id, {
      channels: {
        in_app: body.channels?.in_app ?? true,
        email: body.channels?.email ?? true,
        push: body.channels?.push ?? false,
      },
      quietHoursStart: body.quietHoursStart,
      quietHoursEnd: body.quietHoursEnd,
      timezone: body.timezone,
      categoryOpts: body.categoryOpts,
    });
  }

  @Post('notifications')
  enqueue(
    @CurrentUser() user: RequestUser,
    @Body() body: { category?: string; eventId?: string; title?: string; body?: string },
  ) {
    return this.service.enqueueNotification(
      user.id,
      (body.category ?? 'system') as 'system',
      body.eventId ?? '',
      { title: body.title, body: body.body },
    );
  }
  @Get('notifications/inbox')
  inbox(@CurrentUser() user: RequestUser) {
    return this.service.listInAppInbox(user.id);
  }

  @Post('notifications/:id/deliver')
  deliver(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.processDelivery(user.id, id, 'in_app');
  }
  @Get('return-context')
  returnContext(@CurrentUser() user: RequestUser) { return this.service.getReturnContext(user.id); }
  @Post('activity')
  activity(@CurrentUser() user: RequestUser, @Body() body: { date?: string }) { return this.service.recordActivityDay(user.id, body.date ?? new Date().toISOString().slice(0, 10)); }
}
