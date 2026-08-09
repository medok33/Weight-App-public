import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { AIAssistantService } from '../application/ai-assistant.service';
import { AIChatService } from '../application/ai-chat.service';
import { AIMetricsService } from '../application/ai-metrics.service';
import { describeProviderPublicStatus } from '../providers/ai-provider.env';
import { resolveSessionTokenFromHeaders } from '../../auth/domain/session-cookie';

type AssistantBody = {
  prompt: { intent: 'meal_explanation' | 'habit_coach'; version: string; template: string };
  data?: Record<string, unknown>;
};

@Controller('assistant')
export class AIAssistantController {
  constructor(
    @Inject(AIAssistantService) private readonly service: AIAssistantService,
    @Inject(AIChatService) private readonly chat: AIChatService,
    @Inject(AIMetricsService) private readonly metrics: AIMetricsService,
  ) {}

  private ownerToken(token?: string, cookie?: string) {
    return resolveSessionTokenFromHeaders({ token, cookie });
  }

  @Public()
  @Post('complete')
  complete(@Body() body: AssistantBody) {
    return this.service.complete(body.prompt, body.data ?? {});
  }

  @Public()
  @Get('owner-control')
  async control(@Headers('x-session-token') token: string | undefined, @Headers('cookie') cookie: string | undefined) {
    try {
      return await this.service.controlByToken(this.ownerToken(token, cookie));
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Public()
  @Post('owner-control')
  async setControl(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { enabled?: unknown },
  ) {
    if (typeof body?.enabled !== 'boolean') throw new BadRequestException('AI_CONTROL_INVALID');
    try {
      return await this.service.setControlByToken(this.ownerToken(token, cookie), body.enabled);
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Public()
  @Post('admin/subscription')
  async setSubscription(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { targetUserId?: unknown; tier?: unknown },
  ) {
    if (typeof body?.targetUserId !== 'string' || (body.tier !== 'FREE' && body.tier !== 'PREMIUM')) {
      throw new BadRequestException('SUBSCRIPTION_INVALID');
    }
    try {
      await this.service.setSubscriptionByToken(this.ownerToken(token, cookie), body.targetUserId, body.tier);
      return { ok: true, targetUserId: body.targetUserId, tier: body.tier };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('conversations')
  listConversations(@CurrentUser() user: RequestUser) {
    return this.chat.listConversations(user.id);
  }

  @Post('conversations')
  createConversation(@CurrentUser() user: RequestUser, @Body() body: { title?: unknown }) {
    const title = typeof body.title === 'string' ? body.title : undefined;
    return this.chat.createConversation(user.id, title);
  }

  @Get('conversations/:id/messages')
  async listMessages(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    try {
      return await this.chat.listMessages(user.id, id);
    } catch (error) {
      throw this.mapChatError(error);
    }
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: { content?: unknown },
  ) {
    if (typeof body?.content !== 'string') throw new BadRequestException('MESSAGE_INVALID');
    try {
      return await this.chat.sendMessage(user.id, body.content, id);
    } catch (error) {
      throw this.mapChatError(error);
    }
  }

  @Post('messages')
  async sendFirstMessage(@CurrentUser() user: RequestUser, @Body() body: { content?: unknown }) {
    if (typeof body?.content !== 'string') throw new BadRequestException('MESSAGE_INVALID');
    try {
      return await this.chat.sendMessage(user.id, body.content);
    } catch (error) {
      throw this.mapChatError(error);
    }
  }

  @Get('context')
  getContext(@CurrentUser() user: RequestUser) {
    return this.chat.getContextSnapshot(user.id);
  }

  @Get('usage')
  getUsage(@CurrentUser() user: RequestUser) {
    return this.chat.getUsage(user.id);
  }

  @Get('provider-status')
  @UseGuards(RolesGuard, OwnerMfaGuard)
  @Roles('OWNER')
  providerStatus() {
    return describeProviderPublicStatus();
  }

  @Public()
  @Get('metrics')
  async getMetrics(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ) {
    try {
      await this.service.requireOwnerByToken(this.ownerToken(token, cookie));
      return this.metrics.getSummary();
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  /**
   * Owner-only AI sandbox for limit testing.
   * Enabled in non-production OR when OWNER_AI_SANDBOX=true.
   */
  @Public()
  @Post('owner-sandbox')
  async ownerSandbox(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { action?: unknown; tier?: unknown },
  ) {
    const enabled = process.env.NODE_ENV !== 'production' || process.env.OWNER_AI_SANDBOX === 'true';
    if (!enabled) throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    try {
      const owner = await this.service.requireOwnerByToken(this.ownerToken(token, cookie));
      const action = String(body?.action ?? '');
      if (action === 'set-test-tier') {
        if (body?.tier !== 'FREE' && body?.tier !== 'PREMIUM') throw new BadRequestException('SUBSCRIPTION_INVALID');
        await this.service.setSubscriptionByToken(this.ownerToken(token, cookie), owner.userId, body.tier);
        return { ok: true, action, tier: body.tier };
      }
      if (action === 'model-routing') {
        return { ok: true, action, routing: await this.metrics.getSummary(owner.userId) };
      }
      if (action === 'reset-own-quota') {
        // Soft reset marker: owners inspect usage via metrics; hard wipe of AIUsageLog is intentionally unsupported.
        return { ok: true, action, note: 'quota reset requires waiting for UTC day rollover; use set-test-tier for limit tests' };
      }
      throw new BadRequestException('SANDBOX_ACTION_INVALID');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('messages/:messageId/feedback')
  async submitFeedback(
    @Param('messageId') messageId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: { rating?: unknown },
  ) {
    if (body.rating !== 'up' && body.rating !== 'down') throw new BadRequestException('FEEDBACK_INVALID');
    try {
      return await this.chat.submitFeedback(user.id, messageId, body.rating);
    } catch (error) {
      throw this.mapChatError(error);
    }
  }

  @Post('feedback/batch')
  async listFeedback(@CurrentUser() user: RequestUser, @Body() body: { messageIds?: unknown }) {
    if (!Array.isArray(body.messageIds)) throw new BadRequestException('FEEDBACK_INVALID');
    const messageIds = body.messageIds.filter((id): id is string => typeof id === 'string');
    return this.chat.listMessageFeedback(user.id, messageIds);
  }

  private mapChatError(error: unknown) {
    if (!(error instanceof Error)) return error;
    if (
      error.message === 'AI_KILL_SWITCH_ACTIVE' ||
      error.message === 'AI_INJECTION_DETECTED' ||
      error.message === 'CONVERSATION_NOT_FOUND' ||
      error.message === 'AI_DAILY_LIMIT_EXCEEDED' ||
      error.message === 'MESSAGE_EMPTY' ||
      error.message === 'MESSAGE_NOT_FOUND' ||
      error.message === 'FEEDBACK_ASSISTANT_ONLY' ||
      error.message === 'FEEDBACK_INVALID'
    ) {
      return new BadRequestException(error.message);
    }
    if (
      error.message === 'AI_PROVIDER_NOT_CONFIGURED' ||
      error.message === 'AI_PROVIDER_AUTH_FAILED' ||
      error.message === 'AI_PROVIDER_TEMPORARILY_UNAVAILABLE' ||
      error.message === 'AI_PROVIDER_TIMEOUT' ||
      error.message === 'AI_PROVIDER_RATE_LIMITED' ||
      error.message === 'AI_PROVIDER_EMPTY_RESPONSE' ||
      error.message === 'AI_PROVIDER_INVALID_RESPONSE'
    ) {
      return new BadRequestException(error.message);
    }
    return error;
  }
}
