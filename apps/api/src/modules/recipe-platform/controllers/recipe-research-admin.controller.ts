import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import { RequireRecentOwnerReauth } from '../../auth/decorators/require-recent-owner-reauth.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { RecipeResearchService } from '../application/recipe-research.service';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';

@Controller()
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class RecipeResearchAdminController {
  constructor(@Inject(RecipeResearchService) private readonly research: RecipeResearchService) {}

  @Get('admin/recipe-research')
  async list(@Query('limit') limit?: string) {
    try {
      return await this.research.listRequests(Number(limit ?? 30));
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research')
  async create(@CurrentUser() user: RequestUser, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      return await this.research.createRequest({
        searchDecisionId: (body.searchDecisionId as string | null) ?? null,
        reason: String(body.reason ?? ''),
        idempotencyKey: String(body.idempotencyKey ?? ''),
        actorUserId: actor.id,
        actorRole: actor.role,
        manual: body.manual === true,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-research/:id')
  async get(@Param('id') id: string) {
    try {
      return await this.research.getRequest(id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/:id/cancel')
  async cancel(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      return await this.research.cancelRequest({
        id,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: String(body.reason ?? ''),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/:id/run')
  async run(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      return await this.research.runRequest({
        requestId: id,
        sourceId: (body.sourceId as string | null) ?? null,
        externalId: (body.externalId as string | null) ?? null,
        operation: body.operation as never,
        manualPayload: (body.manualPayload as Record<string, unknown> | null) ?? null,
        actorUserId: actor.id,
        actorRole: actor.role,
        idempotencyKey: String(body.idempotencyKey ?? ''),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-research/:id/runs')
  async runs(@Param('id') id: string) {
    try {
      return await this.research.listRuns(id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-research/:id/candidates')
  async requestCandidates(@Param('id') id: string) {
    try {
      return await this.research.listCandidates(id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-research/candidates')
  async allCandidates() {
    try {
      return await this.research.listCandidates();
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-research/candidates/:candidateId')
  async candidate(@Param('candidateId') candidateId: string) {
    try {
      return await this.research.getCandidate(candidateId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/candidates/:candidateId/normalize')
  async normalize(@CurrentUser() user: RequestUser, @Param('candidateId') candidateId: string) {
    try {
      const actor = this.actor(user);
      return await this.research.normalizeCandidate({
        candidateId,
        actorUserId: actor.id,
        actorRole: actor.role,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/candidates/:candidateId/reject')
  @RequireRecentOwnerReauth()
  async reject(@CurrentUser() user: RequestUser, @Param('candidateId') candidateId: string, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      return await this.research.updateCandidateStatus({
        candidateId,
        actorUserId: actor.id,
        actorRole: actor.role,
        status: 'REJECTED',
        reason: String(body.reason ?? ''),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/candidates/:candidateId/archive')
  @RequireRecentOwnerReauth()
  async archive(@CurrentUser() user: RequestUser, @Param('candidateId') candidateId: string, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      return await this.research.updateCandidateStatus({
        candidateId,
        actorUserId: actor.id,
        actorRole: actor.role,
        status: 'ARCHIVED',
        reason: String(body.reason ?? ''),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-research/candidates/:candidateId/raw')
  async raw(@CurrentUser() user: RequestUser, @Param('candidateId') candidateId: string) {
    try {
      const actor = this.actor(user);
      return await this.research.getRawSnapshot({ candidateId, actorRole: actor.role });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/review-items/:reviewItemId/resolve')
  async resolveReviewItem(
    @CurrentUser() user: RequestUser,
    @Param('reviewItemId') reviewItemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.research.resolveReviewItem({
        reviewItemId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: String(body.reason ?? ''),
        dismiss: false,
        productId: (body.productId as string | null) ?? null,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/review-items/:reviewItemId/dismiss')
  async dismissReviewItem(
    @CurrentUser() user: RequestUser,
    @Param('reviewItemId') reviewItemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.research.resolveReviewItem({
        reviewItemId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: String(body.reason ?? ''),
        dismiss: true,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-research/retention/run')
  async retention(@CurrentUser() user: RequestUser) {
    try {
      const actor = this.actor(user);
      if (actor.role.toUpperCase() !== 'OWNER') throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
      return await this.research.runRetentionJob({ actorUserId: actor.id });
    } catch (error) {
      this.mapError(error);
    }
  }

  private actor(user: RequestUser) {
    const id = user.id;
    if (!id) throw new UnauthorizedException('AUTH_REQUIRED');
    return { id, role: String(user.role ?? '') };
  }

  private mapError(error: unknown): never {
    if (error instanceof RecipeSourceAdapterError) throw new ForbiddenException(error.toPublic());
    if (error instanceof ForbiddenException) throw error;
    const message = error instanceof Error ? error.message : 'RECIPE_RESEARCH_ERROR';
    if (message === 'OWNER_ACCESS_FORBIDDEN') throw new UnauthorizedException(message);
    if (message.includes('NOT_FOUND')) throw new NotFoundException(message);
    throw new ForbiddenException({ code: message, message });
  }
}
