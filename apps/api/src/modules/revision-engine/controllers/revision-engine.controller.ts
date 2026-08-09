import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { RevisionEngineService } from '../application/revision-engine.service';
import { parseConfirmBody, parsePreviewBody } from '../dto/revision-engine.request.dto';
import { toConfirmResponse, toPreviewResponse } from '../dto/revision-engine.response.dto';

@Controller('plans')
export class RevisionEngineController {
  constructor(@Inject(RevisionEngineService) private readonly service: RevisionEngineService) {}

  @Post(':planId/revisions/preview')
  async preview(
    @CurrentUser() user: RequestUser,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ) {
    try {
      const input = parsePreviewBody(body);
      const preview = await this.service.preview(user.id, planId, input.planKind, input.reason);
      return toPreviewResponse(preview);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':planId/revisions/confirm')
  async confirm(
    @CurrentUser() user: RequestUser,
    @Param('planId') planId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      if (!idempotencyKey) throw new Error('REVISION_IDEMPOTENCY_KEY_INVALID');
      const input = parseConfirmBody(body);
      const result = await this.service.confirm({
        userId: user.id,
        planId,
        planKind: input.planKind,
        confirmationToken: input.confirmationToken,
        idempotencyKey,
      });
      return toConfirmResponse(result);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':planId/revisions/cancel')
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param('planId') planId: string,
    @Body() body: { planKind?: string },
  ) {
    try {
      const planKind = body?.planKind === 'workout' ? 'workout' : 'meal';
      return await this.service.cancelPreview(user.id, planId, planKind);
    } catch (error) {
      throw mapError(error);
    }
  }
}

function mapError(error: unknown): Error {
  const code = error instanceof Error ? error.message : 'REVISION_FAILED';
  if (code === 'REVISION_PLAN_FORBIDDEN' || code === 'REVISION_TOKEN_FORBIDDEN') {
    return new ForbiddenException(code);
  }
  if (code === 'IDEMPOTENCY_KEY_REUSED' || code === 'REVISION_VERSION_CONFLICT' || code === 'REVISION_PREVIEW_STALE' || code === 'REVISION_CANDIDATE_UNAVAILABLE') {
    return new ConflictException(code);
  }
  if (code === 'REVISION_PLAN_NOT_FOUND') return new NotFoundException(code);
  return new BadRequestException(code);
}
